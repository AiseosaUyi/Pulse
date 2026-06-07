// Cron observability (PULSE-SEO-SPEC.md §16). One cron_runs row per
// invocation (mig 047). Drop-in: wrap a cron's body in withCronRun.
//
// Existing non-SEO crons are intentionally NOT retrofitted in this
// module branch (blast radius / review scope) — tracked as a follow-up.
// New SEO crons use this from day one.

import { createAdminClient } from "@/lib/supabase/admin";

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
    throw err;
  }
}
