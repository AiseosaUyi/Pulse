-- F1 own-content analytics: per-tenant post metrics across IG/TikTok/Twitter/LinkedIn.
-- Fed via CSV import (Meta/TikTok/LinkedIn exports) and screenshot + AI vision
-- (for Twitter, where exports no longer exist, and for one-off captures).

create table if not exists own_post_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  post_id uuid references posts(id) on delete set null,
  platform text not null check (platform in ('instagram','tiktok','twitter','linkedin')),
  external_url text,
  title text,
  caption text,
  captured_at timestamptz not null default now(),
  source text not null check (source in ('csv','screenshot','manual')),
  metrics jsonb not null default '{}',
  -- metrics shape: { views?, likes?, comments?, shares?, saves?, reach?, impressions?, engagement_rate? }
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_own_post_metrics_tenant_captured
  on own_post_metrics(tenant_slug, captured_at desc);
create index if not exists idx_own_post_metrics_tenant_platform
  on own_post_metrics(tenant_slug, platform, captured_at desc);

alter table own_post_metrics enable row level security;

drop policy if exists "members access own_post_metrics" on own_post_metrics;
create policy "members access own_post_metrics" on own_post_metrics
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
