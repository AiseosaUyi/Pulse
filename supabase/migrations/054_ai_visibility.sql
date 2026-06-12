-- AI-search visibility (GEO/AEO). Tracks whether gruve.events is cited in
-- AI answer engines (Perplexity / Google AI Overviews) for tracked queries —
-- the AI-era complement to classic Google rank tracking.
--
-- Grain: one row per (tenant_slug, query, engine, date). A daily maintenance
-- step asks each engine the query and records whether our domain was cited
-- and at what citation position. Dormant (writes nothing) until an engine is
-- configured (e.g. PERPLEXITY_API_KEY) — never fabricates a citation.

create table if not exists ai_visibility_daily (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null references tenants(slug) on delete cascade,
  query        text not null,
  engine       text not null check (engine in ('perplexity', 'google_aio')),
  date         date not null,
  cited        boolean not null default false,
  position     integer,            -- citation index (1 = first source), null if not cited
  source_url   text,               -- the cited gruve.events URL, if any
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_ai_visibility_daily
  on ai_visibility_daily(tenant_slug, query, engine, date);

create index if not exists idx_ai_visibility_tenant_date
  on ai_visibility_daily(tenant_slug, date desc);

alter table ai_visibility_daily enable row level security;

drop policy if exists "members access ai_visibility_daily" on ai_visibility_daily;
create policy "members access ai_visibility_daily" on ai_visibility_daily
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
