-- PULSE Ads Tracker (campaigns)
-- Phase 3: ad campaigns per tenant, RLS gated to tenant members

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  platform text not null check (platform in ('instagram', 'tiktok', 'twitter', 'linkedin', 'google', 'facebook', 'youtube')),
  status text not null default 'draft' check (status in ('active', 'paused', 'completed', 'draft')),
  spend numeric(14, 2) not null default 0 check (spend >= 0),
  revenue numeric(14, 2) not null default 0 check (revenue >= 0),
  impressions int not null default 0 check (impressions >= 0),
  clicks int not null default 0 check (clicks >= 0),
  conversions int not null default 0 check (conversions >= 0),
  start_date date,
  end_date date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_date_order check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists idx_campaigns_tenant on campaigns(tenant_slug);
create index if not exists idx_campaigns_tenant_status on campaigns(tenant_slug, status);

alter table campaigns enable row level security;

drop policy if exists "members access campaigns" on campaigns;
create policy "members access campaigns" on campaigns
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_campaigns_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function public.touch_campaigns_updated_at();
