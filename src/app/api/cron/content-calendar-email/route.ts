// Individual-persona content-calendar morning email — a dedicated cron
// route (not a branch inside /api/cron/daily-email, which is one
// monolithic function hardcoded to scheduled_posts + intel_cards with no
// persona branch). Same blast-radius reasoning as the trend-sourcing
// decision: a bug here must not risk the existing startup-persona digest.
// Design doc ENG REVIEW, locked decision #3.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { brevo } from "@/lib/email/brevo";
import {
  contentCalendarAssignmentHtml,
  contentCalendarEmptyQueueHtml,
} from "@/lib/email/content-calendar-email";
import { getNextUnpostedSlot } from "@/lib/services/content-calendar-lifecycle";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import { isSlotStale } from "@/lib/types/content-calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const sent: string[] = [];
  const errors: string[] = [];

  const { data: tenants } = await admin.from("tenants").select("slug, name");
  if (!tenants?.length) return NextResponse.json({ sent: 0 });

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  for (const tenant of tenants) {
    if (!isContentCalendarEnabledForTenant(tenant.slug)) continue;

    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_slug", tenant.slug)
      .eq("role", "owner");
    if (!memberships?.length) continue;

    const nextSlot = await getNextUnpostedSlot(admin, tenant.slug);
    const html = nextSlot
      ? contentCalendarAssignmentHtml({
          date: dateLabel,
          topicTitle: nextSlot.topicTitle,
          talkingPoints: nextSlot.topicBrief.talkingPoints,
          stale: isSlotStale(nextSlot),
        })
      : contentCalendarEmptyQueueHtml();
    const subject = nextSlot
      ? `Today's assignment — ${nextSlot.topicTitle}`
      : "Your content queue is empty — generate more";

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
          subject,
          htmlContent: html,
        });
        sent.push(tenant.slug);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${tenant.slug}/${email}: ${msg}`);
      }
    }
  }

  return NextResponse.json({ sent: sent.length, tenants: sent, errors });
}

// Vercel Cron invokes scheduled endpoints with GET; alias per the existing
// daily-email convention (GET previously 405ed on crons that only defined POST).
export const GET = POST;
