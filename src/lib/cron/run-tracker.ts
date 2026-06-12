// Cron observability (PULSE-SEO-SPEC.md §16). One cron_runs row per
// invocation (mig 047). Drop-in: wrap a cron's body in withCronRun.
//
// Existing non-SEO crons are intentionally NOT retrofitted in this
// module branch (blast radius / review scope) — tracked as a follow-up.
// New SEO crons use this from day one.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendBrevoEmail } from "@/lib/integrations/brevo";

// How many consecutive failed runs (including the current one) trigger an
// ops alert. Quiet until CRON_ALERT_EMAIL is configured.
const FAILURE_ALERT_THRESHOLD = 3;

export interface CronRunResult {
  status?: "ok" | "partial" | "skipped" | "failed";
  rowsProcessed?: number;
  metadata?: Record<string, unknown>;
  tenantSlug?: string | null;
}

export async function withCronRun(
  jobName: string,
  fn: () => Promise<CronRunResult | void>
): Promise<CronRunResult> {
  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from("cron_runs")
    .insert({ job_name: jobName, status: "running" })
    .select("id")
    .single();
  const runId = row?.id as string | undefined;

  const finish = async (patch: Record<string, unknown>) => {
    if (!runId) return;
    await supabase
      .from("cron_runs")
      .update({ finished_at: new Date().toISOString(), ...patch })
      .eq("id", runId);
  };

  try {
    const res = (await fn()) ?? {};
    const status = res.status ?? "ok";
    await finish({
      status,
      rows_processed: res.rowsProcessed ?? 0,
      metadata: res.metadata ?? null,
      tenant_slug: res.tenantSlug ?? null,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: { message } });
    await maybeAlertOnRepeatedFailure(supabase, jobName, message);
    throw err;
  }
}

// Fire a one-shot ops email when a job fails FAILURE_ALERT_THRESHOLD times in a
// row. Best-effort: never let alerting break the cron. No-ops unless
// CRON_ALERT_EMAIL is set.
async function maybeAlertOnRepeatedFailure(
  supabase: ReturnType<typeof createAdminClient>,
  jobName: string,
  latestMessage: string
): Promise<void> {
  const to = process.env.CRON_ALERT_EMAIL;
  if (!to) return;
  try {
    const { data: recent } = await supabase
      .from("cron_runs")
      .select("status")
      .eq("job_name", jobName)
      .order("started_at", { ascending: false })
      .limit(FAILURE_ALERT_THRESHOLD);

    const rows = recent ?? [];
    const allFailed =
      rows.length >= FAILURE_ALERT_THRESHOLD &&
      rows.every((r) => r.status === "failed");
    // Only alert on the exact transition into the threshold, so we send once
    // per failure streak rather than on every subsequent failure.
    const isTransition =
      rows.filter((r) => r.status === "failed").length === FAILURE_ALERT_THRESHOLD;
    if (!allFailed || !isTransition) return;

    await sendBrevoEmail({
      to: { email: to },
      subject: `[Pulse] Cron "${jobName}" failed ${FAILURE_ALERT_THRESHOLD}× in a row`,
      htmlContent: `<p>The <strong>${jobName}</strong> cron has failed ${FAILURE_ALERT_THRESHOLD} consecutive runs.</p><p>Latest error:</p><pre>${latestMessage}</pre><p>Check <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings/system-health">/settings/system-health</a>.</p>`,
      tags: ["cron-alert", jobName],
    });
  } catch {
    // swallow — alerting must never break a cron run
  }
}
