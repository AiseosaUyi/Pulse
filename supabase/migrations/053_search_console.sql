-- Google Search Console query data — the real ranking source.
--
-- A daily maintenance step pulls per-(query, page) impressions/clicks/CTR/
-- average position from the GSC Search Analytics API and upserts here, then
-- auto-fills keyword_rankings.position for tracked keywords (replacing the
-- old manual pencil entry). Striking-distance rows (position 8-20, decent
-- impressions, low CTR) become keyword_capture recommendations.
--
-- Grain: one row per (tenant_slug, query, page, date). GSC data lags ~2-3
-- days, so the sync re-pulls a small trailing window each run; upsert on the
-- natural key keeps it idempotent.

create table if not exists gsc_query_daily (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null references tenants(slug) on delete cascade,
  query        text not null,
  page         text not null,
  date         date not null,
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  ctr          numeric not null default 0,   -- 0..1
  position     numeric not null default 0,   -- average position, 1 = top
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_gsc_query_daily
  on gsc_query_daily(tenant_slug, query, page, date);

-- Tracked-keyword position lookup + striking-distance scans:
-- WHERE tenant_slug = ? AND date >= ? ORDER BY ...
create index if not exists idx_gsc_query_daily_tenant_date
  on gsc_query_daily(tenant_slug, date desc);

-- Match GSC queries to tracked keywords by normalized text.
create index if not exists idx_gsc_query_daily_query
  on gsc_query_daily(tenant_slug, query);

alter table gsc_query_daily enable row level security;

drop policy if exists "members access gsc_query_daily" on gsc_query_daily;
create policy "members access gsc_query_daily" on gsc_query_daily
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- Track the data source on a tracked keyword's position so the UI can show
-- "GSC / Serper / manual" and the sync doesn't clobber a manual override
-- unless newer real data exists. Additive, nullable — no backfill needed.
alter table keyword_rankings
  add column if not exists position_source text
    check (position_source in ('gsc', 'serper', 'manual'));
