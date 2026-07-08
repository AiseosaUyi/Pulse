// Per-platform run tracking for the event-platform scraper (mig 085).
// Mirrors withCronRun (run-tracker.ts) but at platform granularity, which
// didn't exist for ANY platform before this feature — old or new. Also
// mirrors the step-checkpoint pattern from seo_publish_runs/_steps
// (044_seo_publish_runs.sql) so a run's progress is inspectable, not just
// its final status.

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface EventScraperRunResult {
  status: "succeeded" | "failed" | "partial";
  candidatesFound: number;
  prospectsCreated: number;
  error?: Record<string, unknown>;
}

export interface EventScraperRunHandle {
  runId: string;
  recordStep: (step: {
    step: string;
    status: "ok" | "failed" | "skipped";
    durationMs?: number;
    payload?: Record<string, unknown>;
    error?: Record<string, unknown>;
  }) => Promise<void>;
}

export async function withEventScraperRun(
  opts: {
    tenantSlug: string;
    platform: string;
    provider: "apify" | "inhouse";
    trigger: "cron" | "manual";
    triggeredBy?: string | null;
    searchId?: string | null;
  },
  fn: (handle: EventScraperRunHandle) => Promise<EventScraperRunResult>
): Promise<EventScraperRunResult> {
  const admin = createAdminClient();

  const { data: row, error: insertErr } = await admin
    .from("event_scraper_runs")
    .insert({
      tenant_slug: opts.tenantSlug,
      platform: opts.platform,
      provider: opts.provider,
      trigger: opts.trigger,
      triggered_by: opts.triggeredBy ?? null,
      search_id: opts.searchId ?? null,
      status: "running",
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    throw new Error(insertErr?.message ?? "Failed to create event_scraper_runs row");
  }
  const runId = row.id as string;
  const attemptCounters = new Map<string, number>();

  const recordStep: EventScraperRunHandle["recordStep"] = async (s) => {
    const attempt = (attemptCounters.get(s.step) ?? 0) + 1;
    attemptCounters.set(s.step, attempt);
    await admin.from("event_scraper_run_steps").insert({
      run_id: runId,
      step: s.step,
      attempt,
      status: s.status,
      duration_ms: s.durationMs ?? null,
      payload: s.payload ?? null,
      error: s.error ?? null,
    });
  };

  try {
    const result = await fn({ runId, recordStep });
    await finishRun(admin, runId, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: EventScraperRunResult = {
      status: "failed",
      candidatesFound: 0,
      prospectsCreated: 0,
      error: { message },
    };
    await finishRun(admin, runId, result);
    throw err;
  }
}

async function finishRun(
  admin: AdminClient,
  runId: string,
  result: EventScraperRunResult
): Promise<void> {
  await admin
    .from("event_scraper_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: result.status,
      candidates_found: result.candidatesFound,
      prospects_created: result.prospectsCreated,
      error: result.error ?? null,
    })
    .eq("id", runId);
}
