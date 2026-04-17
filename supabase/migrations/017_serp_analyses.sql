-- SERP analysis: top Google results for a tracked keyword + AI synthesis of
-- what's working for the ranking pages. One analysis per (tenant, keyword);
-- regeneration overwrites (keyword is the natural idempotency key).

create table if not exists serp_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  keyword text not null,
  region text,
  top_results jsonb not null default '[]',
  -- shape: [{ position, url, domain, title, snippet, serp_features?: string[] }]
  ai_analysis jsonb,
  -- shape: { common_themes, content_length_hint, serp_features, gap_for_us,
  --          how_to_compete, our_angle }
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_serp_analyses_tenant_keyword
  on serp_analyses(tenant_slug, keyword);

create index if not exists idx_serp_analyses_tenant_updated
  on serp_analyses(tenant_slug, updated_at desc);

alter table serp_analyses enable row level security;

drop policy if exists "members access serp_analyses" on serp_analyses;
create policy "members access serp_analyses" on serp_analyses
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_serp_analyses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists serp_analyses_set_updated_at on serp_analyses;
create trigger serp_analyses_set_updated_at
  before update on serp_analyses
  for each row execute function public.touch_serp_analyses_updated_at();
