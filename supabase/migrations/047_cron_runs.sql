-- SEO module Phase 0: cron observability.
--
-- Spec §16 assumed this table exists. It didn't. Adding now so every
-- cron route can record one row per invocation. Used by /settings/ai-usage
-- and the Weekly Review's "data freshness" line.

create table if not exists cron_runs (
  id              uuid primary key default gen_random_uuid(),
  job_name        text not null,
  tenant_slug     text references tenants(slug) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null check (status in ('running','ok','partial','failed','skipped')),
  rows_processed  int  not null default 0,
  error           jsonb,
  metadata        jsonb               -- per-job free-form (e.g. date_range, source)
);

create index if not exists idx_cron_runs_job_started
  on cron_runs(job_name, started_at desc);

create index if not exists idx_cron_runs_tenant_started
  on cron_runs(tenant_slug, started_at desc)
  where tenant_slug is not null;

create index if not exists idx_cron_runs_unfinished
  on cron_runs(started_at)
  where finished_at is null;

alter table cron_runs enable row level security;

-- Per-tenant rows are visible to tenant members; global rows
-- (tenant_slug is null) are admin-only via service role.
drop policy if exists "members read cron_runs" on cron_runs;
create policy "members read cron_runs" on cron_runs
  for select using (
    tenant_slug is not null
    and public.is_tenant_member(tenant_slug)
  );
-- Writes are service-role-only.
