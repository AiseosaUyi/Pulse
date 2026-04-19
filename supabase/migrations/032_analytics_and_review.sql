-- Slice 7a — GA4 inbound data + Weekly Business Review.
-- Coach has been flying blind; this gives it real web metrics.
-- Weekly review synthesizes everything into one narrative per week.

-- Allow 'ga4' as an integration provider. Drop + add the CHECK so
-- older rows keep passing.
alter table tenant_integrations
  drop constraint if exists tenant_integrations_provider_check;
alter table tenant_integrations
  add constraint tenant_integrations_provider_check
  check (provider in ('ayrshare','wordpress','ghost','resend','ga4'));

-- Daily GA4 metrics per page. Keyed by tenant + url + date so we
-- can upsert idempotently during a nightly sync.
create table if not exists web_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  source text not null default 'ga4'
    check (source in ('ga4','manual')),
  /** Page path, e.g. `/blog/how-we-launch` (no host, no query). */
  page_path text not null,
  date date not null,
  pageviews int not null default 0,
  sessions int not null default 0,
  users int not null default 0,
  engagement_time_sec int not null default 0,
  bounce_rate numeric(5,4) default 0,
  conversions int not null default 0,
  /** Raw GA4 metrics snapshot — useful for debugging without schema churn. */
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, source, page_path, date)
);

create index if not exists idx_web_analytics_daily_tenant_date
  on web_analytics_daily(tenant_slug, date desc);

create index if not exists idx_web_analytics_daily_tenant_page
  on web_analytics_daily(tenant_slug, page_path, date desc);

alter table web_analytics_daily enable row level security;

drop policy if exists "members access web_analytics_daily" on web_analytics_daily;
create policy "members access web_analytics_daily" on web_analytics_daily
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_web_analytics_daily_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists web_analytics_daily_set_updated_at on web_analytics_daily;
create trigger web_analytics_daily_set_updated_at
  before update on web_analytics_daily
  for each row execute function public.touch_web_analytics_daily_updated_at();

-- Extend weekly_digests with the new business-review payload.
-- `business_review` holds everything the synthesis pass produced —
-- outbound / coach / distribution / publication / analytics summaries.
-- `narrative` is the one-paragraph human-readable summary.
-- `email_sent_at` tracks whether we emailed it out (Resend).
alter table weekly_digests
  add column if not exists business_review jsonb not null default '{}'::jsonb;
alter table weekly_digests
  add column if not exists narrative text;
alter table weekly_digests
  add column if not exists email_sent_at timestamptz;
