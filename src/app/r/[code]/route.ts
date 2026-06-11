// Public short-link redirect: GET /r/:code → log a click → 302 to the
// destination with UTM params appended. Service-role read (no auth — links are
// meant to be hit by anyone) so RLS doesn't hide the row from the redirector.

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { appendUtm } from "@/lib/attribution/links";

export const dynamic = "force-dynamic";

function hashIp(req: Request): string | null {
  const fwd =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!fwd) return null;
  return createHash("sha256").update(fwd).digest("hex").slice(0, 32);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const fallback = (process.env.NEXT_PUBLIC_APP_URL ?? "/").replace(/\/$/, "");

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("links")
    .select(
      "id, tenant_slug, destination_url, utm_source, utm_medium, utm_campaign, utm_content"
    )
    .eq("code", code)
    .maybeSingle();

  if (!link) {
    return NextResponse.redirect(fallback || "/", { status: 302 });
  }

  // Log the click. Best-effort — never block the redirect on telemetry.
  await admin
    .from("link_clicks")
    .insert({
      link_id: link.id,
      tenant_slug: link.tenant_slug,
      user_agent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
      ip_hash: hashIp(req),
    })
    .then(() => undefined);

  const target = appendUtm(link.destination_url, {
    utm_source: link.utm_source,
    utm_medium: link.utm_medium,
    utm_campaign: link.utm_campaign,
    utm_content: link.utm_content,
  });

  return NextResponse.redirect(target, { status: 302 });
}
