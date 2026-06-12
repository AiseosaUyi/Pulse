// Cron health for /settings/system-health. Reads cron_runs via the admin
// client because most cron rows are global (tenant_slug = null) and the
// RLS-scoped SSR client can't see them. Read-only / observability.

import { createAdminClient } from "@/lib/supabase/admin";

// Expected cadence per job, in hours. Drives the "stale" flag: a job is stale
// when its last run started longer than 2× its interval ago. Mirrors the
// schedule in vercel.json (SEO jobs are consolidated under seo-maintenance).
const EXPECTED_INTERVAL_HOURS: Record<string, number> = {
  "scrape-trends": 24,
  "generate-briefs": 168,
  "weekly-digest": 168,
  "discover-prospects": 24,
  "qualify-backlog": 24,
  "scrape-ticketing-platforms": 24,
  "composio-sync-engagement": 24,
  "composio-sync-insights": 24,
  "drive-reconcile": 24,
  "seo-maintenance": 24,
};

export type CronHealthState = "ok" | "stale" | "failing" | "never_run";

export interface CronJobHealth {
  jobName: string;
  state: CronHealthState;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  rowsProcessed: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  intervalHours: number;
}

interface CronRunRow {
  job_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  error: { message?: string } | null;
}

export async function getCronHealth(): Promise<CronJobHealth[]> {
  const admin = createAdminClient();
  // Recent window is enough to compute latest + a short failure streak.
  const { data } = await admin
    .from("cron_runs")
    .select("job_name, status, started_at, finished_at, rows_processed, error")
    .order("started_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as CronRunRow[];
  const byJob = new Map<string, CronRunRow[]>();
  for (const r of rows) {
    const list = byJob.get(r.job_name) ?? [];
    list.push(r);
    byJob.set(r.job_name, list);
  }

  // Union of jobs we expect and jobs we've actually seen.
  const jobNames = new Set<string>([
    ...Object.keys(EXPECTED_INTERVAL_HOURS),
    ...byJob.keys(),
  ]);
  const now = Date.now();

  return [...jobNames]
    .map((jobName): CronJobHealth => {
      const runs = byJob.get(jobName) ?? [];
      const intervalHours = EXPECTED_INTERVAL_HOURS[jobName] ?? 24;
      const latest = runs[0] ?? null;

      let consecutiveFailures = 0;
      for (const r of runs) {
        if (r.status === "failed") consecutiveFailures += 1;
        else break;
      }

      let state: CronHealthState;
      if (!latest) {
        state = "never_run";
      } else if (consecutiveFailures > 0) {
        state = "failing";
      } else {
        const ageH = (now - new Date(latest.started_at).getTime()) / 3_600_000;
        state = ageH > intervalHours * 2 ? "stale" : "ok";
      }

      return {
        jobName,
        state,
        lastStatus: latest?.status ?? null,
        lastStartedAt: latest?.started_at ?? null,
        lastFinishedAt: latest?.finished_at ?? null,
        rowsProcessed: latest?.rows_processed ?? null,
        lastError: latest?.error?.message ?? null,
        consecutiveFailures,
        intervalHours,
      };
    })
    .sort((a, b) => {
      // Surface problems first: failing > never_run > stale > ok.
      const rank: Record<CronHealthState, number> = {
        failing: 0,
        never_run: 1,
        stale: 2,
        ok: 3,
      };
      return rank[a.state] - rank[b.state] || a.jobName.localeCompare(b.jobName);
    });
}

// True when any job is failing, stale, or has never run — used to badge the
// sidebar / settings nav.
export function hasCronHealthIssues(jobs: CronJobHealth[]): boolean {
  return jobs.some((j) => j.state !== "ok");
}
