-- Cadence loop (loop-first) — two new tenant-scoped tables.
--
-- social_drafts: quick-take drafts from the Composer. A NEW table, not a
--   reuse of content_distributions (which requires a non-null blog_post_id
--   and is shaped for blog→channel artifacts) or own_post_metrics (which is
--   metrics-shaped). Quick takes are their own thing.
--
-- post_log: append-only honor-system "I posted" log that drives the cadence
--   tracker (done/NOW/missed, x/N, 7-day streak). NO unique constraint by
--   design: daily_target can exceed the number of windows (so multiple posts
--   can map to one window), and a nullable window_id (ad-hoc posts outside any
--   window) would not dedupe in Postgres anyway (NULLs are distinct). Accidental
--   double-submit is prevented in the app layer (client debounce + recent-row
--   guard), not by a DB constraint.
--
-- Cadence CONFIG (windows, daily_target, IANA timezone) lives in
-- tenants.settings.cadence JSON, not a table — see services/tenants.ts.

create table if not exists social_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  mode text not null check (mode in ('original','reply','quote')),
  original_text text not null,
  source_url text,
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_social_drafts_tenant_created
  on social_drafts(tenant_slug, created_at desc);

alter table social_drafts enable row level security;

drop policy if exists "members access social_drafts" on social_drafts;
create policy "members access social_drafts" on social_drafts
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ──────────────────────────────────────────────────────────

create table if not exists post_log (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  -- Label of the cadence window this post counts toward (matches a window
  -- id/label in tenants.settings.cadence). Nullable = posted outside any window.
  window_id text,
  -- The local calendar date (in the tenant's IANA tz) this post counts for.
  -- Resolved server-side at insert; drives "missed" + the 7-day streak.
  posted_date date not null,
  platform text,
  source_draft_id uuid references social_drafts(id) on delete set null,
  posted_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- Streak / adherence queries hit (tenant, date). No unique constraint (see header).
create index if not exists idx_post_log_tenant_date
  on post_log(tenant_slug, posted_date desc);

alter table post_log enable row level security;

drop policy if exists "members access post_log" on post_log;
create policy "members access post_log" on post_log
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
