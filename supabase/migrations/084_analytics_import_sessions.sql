-- 084: analytics import sessions
-- Tracks each upload as a named batch so users can filter analytics per import
-- and see platform performance over time (monthly / per-upload).

-- Session registry: one row per import batch
create table if not exists analytics_import_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  platform text not null,
  post_count int not null default 0,
  period_start date,         -- earliest captured_at in this batch
  period_end date,           -- latest captured_at in this batch
  imported_at timestamptz not null default now(),
  label text                 -- human-readable, e.g. "Jun 2026 · 235 posts"
);

create index idx_analytics_import_sessions_tenant_platform
  on analytics_import_sessions(tenant_slug, platform, imported_at desc);

alter table analytics_import_sessions enable row level security;

create policy "members read import sessions" on analytics_import_sessions
  for select using (public.is_tenant_member(tenant_slug));
create policy "members insert import sessions" on analytics_import_sessions
  for insert with check (public.is_tenant_member(tenant_slug));

-- Tag every metric row with which import batch it came from
alter table own_post_metrics
  add column if not exists import_batch_id uuid references analytics_import_sessions(id) on delete set null;

create index if not exists idx_own_post_metrics_batch
  on own_post_metrics(import_batch_id)
  where import_batch_id is not null;
