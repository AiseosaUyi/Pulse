-- F3 viral spotting: trend_scouts table for TikTok CC scrapes + manual hashtag scouts.
-- Separate from intel_cards (which is per-competitor); trend_scouts tracks
-- broader "what's going viral in our niche" signals.

create table if not exists trend_scouts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','twitter')),
  source text not null check (source in ('creative_center','hashtag_scout','manual')),
  hashtag text,
  external_url text,
  title text,                      -- short label for list view
  summary text not null,           -- description of what's trending
  metrics jsonb not null default '{}',
  -- metrics shape: { views?, likes?, engagement_rate?, trending_rank?, region? }
  ai_analysis jsonb,
  -- shape: { why_viral, format, applicability: 'high'|'medium'|'low'|'n/a', suggested_adaptation }
  applicability text check (applicability in ('high','medium','low','n/a')),
  dismissed_at timestamptz,
  dismissed_reason text,
  captured_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_trend_scouts_tenant_captured
  on trend_scouts(tenant_slug, captured_at desc);
create index if not exists idx_trend_scouts_hashtag
  on trend_scouts(hashtag) where hashtag is not null;
create index if not exists idx_trend_scouts_applicability
  on trend_scouts(tenant_slug, applicability) where applicability is not null;

-- Idempotency for TikTok CC scrapes is handled in scrape route handler via
-- a "same hashtag in last 7 days" check — date_trunc isn't immutable enough
-- to use in a partial unique index on timestamptz columns.

alter table trend_scouts enable row level security;

drop policy if exists "members access trend_scouts" on trend_scouts;
create policy "members access trend_scouts" on trend_scouts
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
