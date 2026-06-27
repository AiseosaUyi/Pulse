// Runs Sunday 8am UTC — one hour after weekly-digest (7am) generates the review.
// Emails each tenant's owner(s) their Weekly Business Review.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { resend } from "@/lib/email/resend";
import { weeklyDigestHtml } from "@/lib/email/weekly-digest-email";
import type { WeeklyReview } from "@/lib/ai/weekly-review";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface DigestRow {
  id: string;
  tenant_slug: string;
  narrative: string | null;
  business_review: Partial<WeeklyReview> | null;
  week_of: string;
  tenants: { name: string } | null;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const sent: string[] = [];
  const errors: string[] = [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: digests, error: digestErr } = await admin
    .from("weekly_digests")
    .select("id, tenant_slug, narrative, business_review, week_of, tenants(name)")
    .gte("created_at", sevenDaysAgo)
    .is("email_sent_at", null)
    .not("narrative", "is", null);

  if (digestErr) {
    return NextResponse.json({ error: digestErr.message }, { status: 500 });
  }

  const rows = (digests ?? []).map((d) => ({
    ...d,
    tenants: Array.isArray(d.tenants) ? d.tenants[0] ?? null : d.tenants,
  })) as DigestRow[];

  for (const digest of rows) {
    if (!digest.narrative) continue;

    const tenantName = digest.tenants?.name ?? digest.tenant_slug;
    const review = digest.business_review as WeeklyReview | null;

    // Get owners for this tenant
    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_slug", digest.tenant_slug)
      .eq("role", "owner");

    if (!memberships?.length) continue;

    const html = weeklyDigestHtml({
      tenantName,
      weekOf: digest.week_of,
      narrative: digest.narrative,
      wins: review?.wins ?? [],
      drags: review?.drags ?? [],
      nextWeekFocus: review?.next_week_focus ?? [],
      aiCostUsd: (digest.business_review as { spend?: { ai_cost_usd?: number } } | null)
        ?.spend?.ai_cost_usd ?? 0,
    });

    let tenantSent = false;
    for (const { user_id } of memberships) {
      const { data: authUser } = await admin.auth.admin.getUserById(user_id);
      const email = authUser?.user?.email;
      if (!email) continue;

      const { error: sendErr } = await resend.emails.send({
        from: "Pulse <digest@pulse.gruve.events>",
        to: email,
        subject: `Your Pulse Weekly Review — ${digest.week_of}`,
        html,
      });

      if (sendErr) {
        errors.push(`${digest.tenant_slug}/${email}: ${sendErr.message}`);
      } else {
        tenantSent = true;
      }
    }

    if (tenantSent) {
      await admin
        .from("weekly_digests")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", digest.id);
      sent.push(digest.tenant_slug);
    }
  }

  return NextResponse.json({ sent: sent.length, tenants: sent, errors });
}
