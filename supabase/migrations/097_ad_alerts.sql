-- Event-shaped signals surfaced to the dashboard/coach: Meta's own
-- creative_fatigue/disapproval/recommendation webhooks (pushed, not
-- polled — see /api/webhooks/meta-ads), plus derived anomaly/fatigue
-- alerts computed from insights trends for platforms with no native
-- signal (TikTok has none — see detect-creative-fatigue cron).
create table if not exists ad_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  level text not null check (level in ('campaign', 'adset', 'ad')),
  external_id text not null,
  alert_type text not null check (alert_type in ('creative_fatigue', 'disapproved', 'with_issues', 'recommendation', 'cpa_anomaly', 'audience_overlap')),
  severity text check (severity in ('low', 'medium', 'high')),
  message text not null,
  raw jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_ad_alerts_tenant_unresolved
  on ad_alerts(tenant_slug, created_at desc) where not resolved;
create index if not exists idx_ad_alerts_object
  on ad_alerts(ad_account_id, level, external_id);

alter table ad_alerts enable row level security;

drop policy if exists "members read ad_alerts" on ad_alerts;
create policy "members read ad_alerts" on ad_alerts
  for select using (public.is_tenant_member(tenant_slug));
