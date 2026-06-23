// Daily cron: flag platform connections expiring within 7 days.
// Sends a Brevo email to the tenant owner.

import { NextResponse } from "next/server";
import { getExpiringConnections } from "@/lib/services/platform-connections";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expiring = await getExpiringConnections(7);
  if (expiring.length === 0) return NextResponse.json({ ok: true, flagged: 0 });

  const admin = createAdminClient();
  const brevoKey = process.env.BREVO_API_KEY;
  let emailed = 0;

  // Group by tenant and email the owner
  const byTenant = new Map<string, typeof expiring>();
  for (const conn of expiring) {
    const list = byTenant.get(conn.tenantSlug) ?? [];
    list.push(conn);
    byTenant.set(conn.tenantSlug, list);
  }

  for (const [tenantSlug, conns] of byTenant) {
    // Get tenant owner email
    const { data: membership } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_slug", tenantSlug)
      .eq("role", "owner")
      .limit(1)
      .single();
    if (!membership) continue;

    const { data: user } = await admin.auth.admin.getUserById(membership.user_id);
    const email = user?.user?.email;
    if (!email || !brevoKey) continue;

    const platformList = conns
      .map((c) => `${c.platform} (expires ${c.expiresAt?.toLocaleDateString() ?? "soon"})`)
      .join(", ");

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Pulse", email: "hello@gruve.events" },
        to: [{ email }],
        subject: "Action needed: reconnect your social accounts in Pulse",
        htmlContent: `<p>Your connection to <strong>${platformList}</strong> will expire soon. <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings/social-publishing">Reconnect in Pulse →</a></p>`,
      }),
    });
    emailed++;
  }

  return NextResponse.json({ ok: true, flagged: expiring.length, emailed });
}
