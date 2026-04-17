-- PULSE Leads & Outreach
-- Phase 3: leads per tenant, RLS gated to tenant members

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  company text,
  type text not null check (type in ('venue', 'sponsor', 'partner', 'influencer', 'media')),
  status text not null default 'new' check (status in ('new', 'contacted', 'warm', 'cold', 'converted')),
  value text not null default 'medium' check (value in ('low', 'medium', 'high', 'very_high')),
  last_contact date,
  next_action text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_tenant on leads(tenant_slug);
create index if not exists idx_leads_tenant_status on leads(tenant_slug, status);

alter table leads enable row level security;

drop policy if exists "members access leads" on leads;
create policy "members access leads" on leads
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row execute function public.touch_leads_updated_at();
