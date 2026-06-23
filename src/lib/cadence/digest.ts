import "server-only";

// End-of-day cadence digest. Loop-first nudge channel: one daily email (Brevo)
// to the tenant owner when they're behind today. NOT intraday/escalating —
// Vercel Hobby crons fire once daily (UTC); schedule it at the founder's
// evening. Web Push escalation is the deferred B5.
//
// Reads post_log via the admin client (service-role can't pass is_tenant_member
// RPCs — CLAUDE.md gotcha #1). Resolves the recipient from the owner membership.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendBrevoEmail } from "@/lib/integrations/brevo";
import { getCadenceConfig } from "@/lib/cadence/config";
import { getTrackerAdmin } from "@/lib/services/cadence";
import { PLATFORM_LABEL } from "@/lib/cadence/types";

export type DigestOutcome =
  | { status: "sent"; email: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

function resolveAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://app.gruve.events")
  );
}

export async function sendCadenceDigest(tenantSlug: string): Promise<DigestOutcome> {
  const config = await getCadenceConfig(tenantSlug);
  if (!config || !config.enabled) {
    return { status: "skipped", reason: "cadence not enabled" };
  }

  const tracker = await getTrackerAdmin(tenantSlug, config);
  if (!tracker.behind) {
    return { status: "skipped", reason: "on track" };
  }

  // Resolve the owner's email via the admin auth API.
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_slug", tenantSlug)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (!membership?.user_id) {
    return { status: "skipped", reason: "no owner membership" };
  }
  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(
    membership.user_id as string
  );
  const email = userRes?.user?.email;
  if (userErr || !email) {
    return { status: "skipped", reason: "owner has no email" };
  }

  const todayUrl = `${resolveAppUrl()}/today`;
  // Per-platform summary, e.g. "X 1/3 · LinkedIn 0/1".
  const lines = tracker.platforms.map((p) => `${PLATFORM_LABEL[p.platform]} ${p.posted}/${p.target}`);
  const behindLines = tracker.platforms
    .filter((p) => p.behind)
    .map((p) => `${PLATFORM_LABEL[p.platform]}: ${p.target - p.posted} to go`);

  const subject = `Your posting cadence — ${lines.join(" · ")}`;
  const textContent = [
    `Today: ${lines.join(" · ")}.`,
    behindLines.length > 0 ? behindLines.join("; ") + "." : "",
    `Draft your next take: ${todayUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const htmlContent = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;color:#2d2b4a">
      <p style="font-size:16px"><strong>${lines.join(" · ")}</strong> posted today.</p>
      ${behindLines.length > 0 ? `<p style="color:#717477;font-size:14px">${behindLines.join("; ")}.</p>` : ""}
      <p><a href="${todayUrl}" style="display:inline-block;background:#ad112c;color:#fff;padding:10px 20px;border-radius:9999px;text-decoration:none;font-weight:bold">Draft your next take</a></p>
      <p style="color:#717477;font-size:12px">You set this cadence in Pulse. Adjust it in Settings → Posting cadence.</p>
    </div>`;

  const res = await sendBrevoEmail({
    to: { email },
    subject,
    htmlContent,
    textContent,
    tags: ["cadence-digest"],
  });
  if (!res.ok) return { status: "failed", reason: res.error };
  return { status: "sent", email };
}
