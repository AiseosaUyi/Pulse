// Runs daily at 8am UTC — sends each tenant's owner(s) a morning briefing:
// today's scheduled posts + top Intel Feed signal + one suggested action.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { brevo } from "@/lib/email/brevo";
import { dailyDigestHtml } from "@/lib/email/daily-digest-email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const sent: string[] = [];
  const errors: string[] = [];

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Get all tenants
  const { data: tenants } = await admin
    .from("tenants")
    .select("slug, name");

  if (!tenants?.length) return NextResponse.json({ sent: 0 });

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  for (const tenant of tenants) {
    const tenantSlug = tenant.slug;

    // Today's scheduled posts
    const { data: posts } = await admin
      .from("scheduled_posts")
      .select("platform, content, status")
      .eq("tenant_slug", tenantSlug)
      .in("status", ["scheduled", "draft"])
      .gte("scheduled_for", todayStart.toISOString())
      .lte("scheduled_for", todayEnd.toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(5);

    // Recent high-engagement intel signals (last 24h)
    const { data: signals } = await admin
      .from("intel_cards")
      .select("competitor_name, platform, summary, metrics, content_type")
      .eq("tenant_id", tenantSlug)
      .gte("detected_at", yesterday)
      .order("detected_at", { ascending: false })
      .limit(10);

    const highSignals = (signals ?? []).filter(
      (s) => (s.metrics as { vsAverage?: number } | null)?.vsAverage &&
        ((s.metrics as { vsAverage?: number }).vsAverage ?? 0) >= 2
    );

    // Skip tenants with nothing to report
    if (!posts?.length && !highSignals.length) continue;

    const scheduledToday = (posts ?? []).map((p) => ({
      platform: p.platform,
      snippet: (p.content as string).slice(0, 80) + ((p.content as string).length > 80 ? "…" : ""),
    }));

    const topSignal = highSignals[0]
      ? {
          competitor: (highSignals[0].competitor_name as string),
          description: `posted a ${highSignals[0].content_type} on ${highSignals[0].platform} that got ${((highSignals[0].metrics as { vsAverage?: number } | null)?.vsAverage ?? 0).toFixed(1)}x their average engagement. ${(highSignals[0].summary as string).slice(0, 120)}`,
          composerUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://pulse.gruve.events"}/composer?angle=${encodeURIComponent((highSignals[0].competitor_name as string) + ": " + (highSignals[0].summary as string).slice(0, 120))}`,
        }
      : null;

    // Get owner emails
    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_slug", tenantSlug)
      .eq("role", "owner");

    if (!memberships?.length) continue;

    const html = dailyDigestHtml({
      tenantName: tenant.name,
      date: dateLabel,
      scheduledToday,
      signalCount: highSignals.length,
      topSignal,
    });

    for (const { user_id } of memberships) {
      const { data: authUser } = await admin.auth.admin.getUserById(user_id);
      const email = authUser?.user?.email;
      if (!email) continue;

      try {
        await brevo.transactionalEmails.sendTransacEmail({
          sender: {
            name: "Pulse",
            email: process.env.BREVO_FROM_EMAIL ?? "digest@pulse.gruve.events",
          },
          to: [{ email }],
          subject: `Your Pulse briefing — ${dateLabel}`,
          htmlContent: html,
        });
        sent.push(tenantSlug);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${tenantSlug}/${email}: ${msg}`);
      }
    }
  }

  return NextResponse.json({ sent: sent.length, tenants: sent, errors });
}
