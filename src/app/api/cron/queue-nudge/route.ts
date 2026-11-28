// Daily at 06:00 UTC (07:00 Africa/Lagos). For every tenant:
// 1. archives queue items that are open and untouched for 30 days (hidden,
//    never deleted; each gets a queue_activity_log row), then
// 2. emails each teammate with open work a short "your queue" note.
// Internal email to teammates only, never to leads or customers.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { sendBrevoEmail } from "@/lib/integrations/brevo";
import { runQueueNudgeForTenant, type TenantNudgeResult } from "@/lib/queue-nudge/nudge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "queue-nudge";

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();

  // Once a day: a retry of the scheduled call must not email everyone twice.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: earlier } = await admin
    .from("cron_runs")
    .select("id")
    .eq("job_name", JOB)
    .in("status", ["ok", "partial"])
    .gte("started_at", dayStart.toISOString())
    .limit(1);
  if (earlier && earlier.length > 0) {
    return NextResponse.json({ skipped: "already ran today" });
  }

  const result = await withCronRun(JOB, async () => {
    const { data: tenants, error } = await admin.from("tenants").select("slug, name");
    if (error || !tenants) throw new Error(error?.message ?? "Failed to list tenants");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://pulse.gruve.events";
    const perTenant: TenantNudgeResult[] = [];

    for (const t of tenants as Array<{ slug: string; name: string | null }>) {
      try {
        perTenant.push(
          await runQueueNudgeForTenant(admin, t, {
            appUrl,
            resolveEmail: async (userId) => {
              const { data } = await admin.auth.admin.getUserById(userId);
              return data?.user?.email ?? null;
            },
            send: async ({ to, name, subject, html }) => {
              const res = await sendBrevoEmail({
                to: { email: to, name },
                subject,
                htmlContent: html,
                tags: ["queue-nudge"],
              });
              return res.ok ? { ok: true } : { ok: false, error: res.error };
            },
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cron/${JOB}] ${t.slug} threw`, message);
        perTenant.push({ tenant: t.slug, archived: 0, emailed: 0, skippedNothingOpen: 0, errors: [message] });
      }
    }

    const emailed = perTenant.reduce((s, r) => s + r.emailed, 0);
    const archived = perTenant.reduce((s, r) => s + r.archived, 0);
    const failed = perTenant.filter((r) => r.errors.length > 0).length;
    const status = failed === 0 ? "ok" : emailed > 0 || archived > 0 ? "partial" : "failed";
    return {
      status,
      rowsProcessed: emailed + archived,
      metadata: {
        emailed,
        archived,
        archivedByTenant: Object.fromEntries(perTenant.map((r) => [r.tenant, r.archived])),
        tenants: perTenant,
      },
    };
  });

  return NextResponse.json(result.metadata ?? result);
}

// Vercel Cron invokes scheduled endpoints with GET.
export const GET = POST;
