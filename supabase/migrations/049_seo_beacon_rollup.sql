-- SEO module: per-(tenant,slug,date) rollup of Gruve reader-analytics
-- beacons (PULSE-SEO-SPEC.md §14, wire contract C4). NOT speculative —
-- columns mirror the fixed C4 event set Gruve committed:
--   blog_view · blog_scroll{depth} · blog_dwell{msActive} ·
--   blog_outbound · blog_internal_link · blog_share · blog_cta_click ·
--   web_vitals (web_vitals not rolled up here; raw kept in
--   seo_webhook_events).
--
-- Canonical analytics source remains Gruve's C5 /api/pulse/engagement;
-- this rollup is the realtime fallback for outcome capture (§9) until
-- Gruve provisions its analytics DB. Beacon carries slug only (no
-- pulseId / tenant) — the normalizer resolves tenant via blog_posts.slug.

create table if not exists seo_post_engagement_daily (
  tenant_slug     text not null references tenants(slug) on delete cascade,
  slug            text not null,
  date            date not null,
  views           int  not null default 0,
  dwell_ms_total  bigint not null default 0,
  scroll_depth_sum int not null default 0,  -- Σ depth (25|50|75|100)
  outbound_clicks int  not null default 0,
  internal_clicks int  not null default 0,
  shares          int  not null default 0,
  cta_clicks      int  not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (tenant_slug, slug, date)
);

create index if not exists idx_seo_engagement_tenant_slug_date
  on seo_post_engagement_daily(tenant_slug, slug, date desc);

alter table seo_post_engagement_daily enable row level security;

drop policy if exists "members read engagement" on seo_post_engagement_daily;
create policy "members read engagement" on seo_post_engagement_daily
  for select using (public.is_tenant_member(tenant_slug));
-- Writes are service-role only (the beacon normalizer cron).
