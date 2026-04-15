-- PULSE Intelligence Feed Schema
-- Phase 1.5: Core tables for competitors, intel cards, and content briefs

-- ─── Competitors ─────────────────────────────────────────────
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  website text,
  type text not null check (type in ('direct', 'aspirational', 'adjacent')),
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  threat_level text not null default 'medium' check (threat_level in ('high', 'medium', 'low')),
  platforms jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index idx_competitors_tenant on competitors(tenant_id);

-- ─── Intel Cards ─────────────────────────────────────────────
create table if not exists intel_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  competitor_id uuid references competitors(id) on delete cascade,
  competitor_name text not null,
  competitor_type text not null,
  platform text not null,
  content_type text not null,
  summary text not null,
  post_url text,
  metrics jsonb not null default '{}',
  ai_recommendation jsonb,
  detected_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('api', 'manual'))
);

create index idx_intel_cards_tenant on intel_cards(tenant_id);
create index idx_intel_cards_detected on intel_cards(tenant_id, detected_at desc);

-- ─── Content Briefs ──────────────────────────────────────────
create table if not exists content_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  triggered_by uuid references intel_cards(id) on delete set null,
  platform text not null,
  content_type text not null,
  title text not null,
  outline text[] default '{}',
  draft_content text,
  seo_keywords text[] default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now()
);

create index idx_content_briefs_tenant on content_briefs(tenant_id);

-- ─── Row Level Security ──────────────────────────────────────
alter table competitors enable row level security;
alter table intel_cards enable row level security;
alter table content_briefs enable row level security;

-- Allow all access for now (internal tool, no auth yet)
-- Phase 2: Replace with proper auth-based policies
create policy "Allow all access to competitors" on competitors for all using (true) with check (true);
create policy "Allow all access to intel_cards" on intel_cards for all using (true) with check (true);
create policy "Allow all access to content_briefs" on content_briefs for all using (true) with check (true);
