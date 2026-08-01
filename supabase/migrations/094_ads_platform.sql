-- Real ads platform. Replaces the manual-entry `campaigns` table (still
-- untouched here — kept for backward compat with the old Ads Critic flow;
-- new code reads from `ad_accounts`/`ad_campaigns`/`ad_insights_daily`
-- instead). Platform-agnostic (meta|tiktok) so every downstream table and
-- every sync/query path is shared code, not per-platform branches.
--
-- Connection storage is split by how each platform is actually reached:
--   - Meta Ads goes through Composio (same OAuth-managed pattern already
--     used for Instagram/TikTok/LinkedIn) — just a new `connected_accounts`
--     toolkit value, no new connection table.
--   - TikTok Ads has no Composio toolkit (confirmed — Composio covers Meta,
--     Google, LinkedIn ads but not TikTok ads management), so it gets its
--     own direct-OAuth table, AES-GCM encrypted tokens exactly like
--     `platform_connections` (066) — deliberately a separate table from
--     `platform_connections` since TikTok Ads is a different app/scope/
--     Advertiser-ID hierarchy than TikTok social publishing.
--
-- `ad_accounts` is the join point: one row per real ad account regardless
-- of which connection mechanism owns its credentials, so every table below
-- it (campaigns/sets/ads/creatives/insights) never has to branch on
-- platform to find its account.

-- ─── Meta Ads via Composio ───────────────────────────────────────────
alter table connected_accounts drop constraint if exists connected_accounts_toolkit_check;
alter table connected_accounts add constraint connected_accounts_toolkit_check
  check (toolkit in ('instagram', 'tiktok', 'linkedin', 'metaads'));

-- ─── TikTok Ads — direct OAuth (no Composio toolkit) ────────────────
create table if not exists tiktok_ads_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  advertiser_id text not null,
  advertiser_name text,
  -- AES-GCM ciphertext: iv(12B) + tag(16B) + ciphertext, base64url encoded —
  -- same encryption scheme as platform_connections (066).
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, advertiser_id)
);

create index if not exists idx_tiktok_ads_connections_tenant
  on tiktok_ads_connections(tenant_slug);

alter table tiktok_ads_connections enable row level security;

drop policy if exists "owners manage tiktok_ads_connections" on tiktok_ads_connections;
create policy "owners manage tiktok_ads_connections" on tiktok_ads_connections
  for all
  using (public.tenant_role(tenant_slug) in ('owner', 'admin'))
  with check (public.tenant_role(tenant_slug) in ('owner', 'admin'));

create or replace function public.touch_tiktok_ads_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tiktok_ads_connections_set_updated_at on tiktok_ads_connections;
create trigger tiktok_ads_connections_set_updated_at
  before update on tiktok_ads_connections
  for each row execute function public.touch_tiktok_ads_connections_updated_at();

-- ─── Unified ad account registry ─────────────────────────────────────
create table if not exists ad_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  platform text not null check (platform in ('meta', 'tiktok')),
  -- 'act_123456789' for Meta, advertiser_id for TikTok.
  external_account_id text not null,
  account_name text,
  currency text not null default 'NGN',
  timezone text,
  -- Exactly one of these is set, matching `platform`.
  connected_account_id uuid references connected_accounts(id) on delete set null,
  tiktok_connection_id uuid references tiktok_ads_connections(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  last_synced_at timestamptz,
  last_insights_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, platform, external_account_id)
);

create index if not exists idx_ad_accounts_tenant on ad_accounts(tenant_slug);
create index if not exists idx_ad_accounts_active_sync
  on ad_accounts(platform, status, last_synced_at)
  where status = 'active';

alter table ad_accounts enable row level security;

drop policy if exists "members read ad_accounts" on ad_accounts;
create policy "members read ad_accounts" on ad_accounts
  for select using (public.is_tenant_member(tenant_slug));
-- INSERT / UPDATE / DELETE: service-role only (sync + connect flows).

-- ─── Creatives (referenced by ads, so defined before them) ──────────
create table if not exists ad_creatives (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  external_id text not null,
  name text,
  headline text,
  body text,
  cta text,
  image_url text,
  video_url text,
  landing_url text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (ad_account_id, external_id)
);

create index if not exists idx_ad_creatives_account on ad_creatives(ad_account_id);

alter table ad_creatives enable row level security;

drop policy if exists "members read ad_creatives" on ad_creatives;
create policy "members read ad_creatives" on ad_creatives
  for select using (public.is_tenant_member(tenant_slug));

-- ─── Campaign structure (synced cache of the platform's own data) ───
create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  external_id text not null,
  name text not null,
  objective text,
  status text not null default 'active' check (status in ('active', 'paused', 'deleted', 'archived')),
  effective_status text,
  budget_mode text check (budget_mode in ('daily', 'lifetime', 'adset_managed')),
  budget_amount numeric,
  bid_strategy text,
  start_time timestamptz,
  end_time timestamptz,
  -- Full platform payload, forward-compatible with fields we haven't
  -- promoted to a column yet.
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_account_id, external_id)
);

create index if not exists idx_ad_campaigns_account on ad_campaigns(ad_account_id);
create index if not exists idx_ad_campaigns_tenant_status on ad_campaigns(tenant_slug, status);

alter table ad_campaigns enable row level security;

drop policy if exists "members read ad_campaigns" on ad_campaigns;
create policy "members read ad_campaigns" on ad_campaigns
  for select using (public.is_tenant_member(tenant_slug));

create table if not exists ad_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  ad_campaign_id uuid not null references ad_campaigns(id) on delete cascade,
  external_id text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'deleted', 'archived')),
  effective_status text,
  budget_mode text check (budget_mode in ('daily', 'lifetime')),
  budget_amount numeric,
  optimization_goal text,
  billing_event text,
  targeting jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_campaign_id, external_id)
);

create index if not exists idx_ad_sets_campaign on ad_sets(ad_campaign_id);

alter table ad_sets enable row level security;

drop policy if exists "members read ad_sets" on ad_sets;
create policy "members read ad_sets" on ad_sets
  for select using (public.is_tenant_member(tenant_slug));

create table if not exists ads (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  ad_set_id uuid not null references ad_sets(id) on delete cascade,
  external_id text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'deleted', 'archived')),
  effective_status text,
  creative_id uuid references ad_creatives(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_set_id, external_id)
);

create index if not exists idx_ads_ad_set on ads(ad_set_id);
create index if not exists idx_ads_creative on ads(creative_id);

alter table ads enable row level security;

drop policy if exists "members read ads" on ads;
create policy "members read ads" on ads
  for select using (public.is_tenant_member(tenant_slug));

-- ─── Performance (the big table — one row per object per day) ──────
create table if not exists ad_insights_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  level text not null check (level in ('campaign', 'adset', 'ad')),
  -- external_id of the campaign/adset/ad this row is scoped to. Not a FK —
  -- insights can land before the structure sync has created the local row
  -- for a brand-new object, and this keeps the insights writer simple.
  external_id text not null,
  date date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint,
  frequency numeric,
  clicks bigint not null default 0,
  link_clicks bigint,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  conversions bigint not null default 0,
  conversion_value numeric not null default 0,
  -- What the platform itself reports (Meta's purchase_roas etc) — kept
  -- distinct from blended ROAS, which is computed separately against real
  -- orders. See src/lib/attribution/ads.ts.
  platform_roas numeric,
  currency text not null default 'NGN',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (ad_account_id, level, external_id, date)
);

create index if not exists idx_ad_insights_daily_account_date
  on ad_insights_daily(ad_account_id, date desc);
create index if not exists idx_ad_insights_daily_object
  on ad_insights_daily(ad_account_id, level, external_id, date desc);
create index if not exists idx_ad_insights_daily_tenant_date
  on ad_insights_daily(tenant_slug, date desc);

alter table ad_insights_daily enable row level security;

drop policy if exists "members read ad_insights_daily" on ad_insights_daily;
create policy "members read ad_insights_daily" on ad_insights_daily
  for select using (public.is_tenant_member(tenant_slug));

-- ─── Budget guardrail rules ──────────────────────────────────────────
create table if not exists ad_budget_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  -- null = evaluated across every account on the tenant.
  ad_account_id uuid references ad_accounts(id) on delete cascade,
  name text not null,
  scope text not null default 'campaign' check (scope in ('account', 'campaign', 'adset')),
  -- null = applies to every object at `scope` under ad_account_id.
  target_external_id text,
  metric text not null check (metric in ('cpa', 'roas', 'ctr', 'frequency', 'spend', 'cpm')),
  comparator text not null check (comparator in ('gt', 'lt', 'gte', 'lte')),
  threshold numeric not null,
  -- Metric must hold true for this many consecutive days before the rule
  -- fires — the anti-noise guardrail every real rule engine in this space
  -- uses (see PULSE-ADS-SPEC discussion; single-datapoint triggers thrash).
  hold_days int not null default 3,
  action text not null check (action in ('pause', 'notify_only', 'increase_budget', 'decrease_budget')),
  action_amount_pct numeric,
  enabled boolean not null default true,
  last_evaluated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ad_budget_rules_tenant_enabled
  on ad_budget_rules(tenant_slug, enabled) where enabled;

alter table ad_budget_rules enable row level security;

drop policy if exists "owners manage ad_budget_rules" on ad_budget_rules;
create policy "owners manage ad_budget_rules" on ad_budget_rules
  for all
  using (public.tenant_role(tenant_slug) in ('owner', 'admin'))
  with check (public.tenant_role(tenant_slug) in ('owner', 'admin'));

create or replace function public.touch_ad_budget_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ad_budget_rules_set_updated_at on ad_budget_rules;
create trigger ad_budget_rules_set_updated_at
  before update on ad_budget_rules
  for each row execute function public.touch_ad_budget_rules_updated_at();

-- Audit log — every evaluation, not just the ones that fired, so a rule's
-- history is inspectable (did it just start being true today, or has it
-- been true for 2 of 3 required days).
create table if not exists ad_budget_rule_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references ad_budget_rules(id) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,
  target_external_id text not null,
  condition_met boolean not null,
  action_taken text,
  metric_value numeric,
  notes text,
  evaluated_at timestamptz not null default now()
);

create index if not exists idx_ad_budget_rule_runs_rule
  on ad_budget_rule_runs(rule_id, evaluated_at desc);

alter table ad_budget_rule_runs enable row level security;

drop policy if exists "members read ad_budget_rule_runs" on ad_budget_rule_runs;
create policy "members read ad_budget_rule_runs" on ad_budget_rule_runs
  for select using (public.is_tenant_member(tenant_slug));

-- ─── Competitor ad intelligence ──────────────────────────────────────
-- Populated from Meta's Ad Library API + TikTok's equivalent. Links to the
-- existing `competitors` table (001_intelligence_feed) so this rides the
-- same Intel Feed surface the rest of competitive intelligence uses.
create table if not exists competitor_ads (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  competitor_id uuid references competitors(id) on delete cascade,
  platform text not null check (platform in ('meta', 'tiktok')),
  external_ad_id text not null,
  page_or_account_name text,
  snapshot_url text,
  creative_body text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  still_active boolean not null default true,
  platforms_delivered text[] not null default '{}',
  -- Heuristic grouping key for near-duplicate creative, so the UI can show
  -- "this concept has N variants running" — the actual signal that matters
  -- more than any single ad's copy (see PULSE-ADS-SPEC).
  variant_group_key text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_slug, platform, external_ad_id)
);

create index if not exists idx_competitor_ads_tenant_competitor
  on competitor_ads(tenant_slug, competitor_id);
create index if not exists idx_competitor_ads_active
  on competitor_ads(tenant_slug, still_active) where still_active;

alter table competitor_ads enable row level security;

drop policy if exists "members read competitor_ads" on competitor_ads;
create policy "members read competitor_ads" on competitor_ads
  for select using (public.is_tenant_member(tenant_slug));
