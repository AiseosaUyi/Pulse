-- PULSE SEO Tracker — keyword rankings
-- Phase 3: tracked keyword positions per tenant, RLS gated to tenant members

create table if not exists keyword_rankings (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  keyword text not null,
  url text,
  position int check (position is null or position >= 1),
  previous_position int check (previous_position is null or previous_position >= 1),
  volume int not null default 0 check (volume >= 0),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  last_checked date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, keyword)
);

create index if not exists idx_keyword_rankings_tenant on keyword_rankings(tenant_slug);
create index if not exists idx_keyword_rankings_tenant_position on keyword_rankings(tenant_slug, position);

alter table keyword_rankings enable row level security;

drop policy if exists "members access keyword_rankings" on keyword_rankings;
create policy "members access keyword_rankings" on keyword_rankings
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_keyword_rankings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists keyword_rankings_set_updated_at on keyword_rankings;
create trigger keyword_rankings_set_updated_at
  before update on keyword_rankings
  for each row execute function public.touch_keyword_rankings_updated_at();
