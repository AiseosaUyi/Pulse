-- Outreach Intelligence — Phase 1
-- Outreach campaigns are a separate concept from ad campaigns (006).
-- Ad campaigns track platform spend/revenue. Outreach campaigns are
-- named programs we use to group prospect outreach (Gruve - Ticketing,
-- Sippoy - Drinks, etc.). A prospect can belong to multiple campaigns.

create table if not exists outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  description text,
  /** The business this campaign belongs to — informational label. */
  business text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_campaigns_tenant_name_unique unique (tenant_slug, name)
);

create index if not exists idx_outreach_campaigns_tenant
  on outreach_campaigns(tenant_slug, status);

alter table outreach_campaigns enable row level security;

drop policy if exists "members access outreach_campaigns" on outreach_campaigns;
create policy "members access outreach_campaigns" on outreach_campaigns
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_outreach_campaigns_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outreach_campaigns_set_updated_at on outreach_campaigns;
create trigger outreach_campaigns_set_updated_at
  before update on outreach_campaigns
  for each row execute function public.touch_outreach_campaigns_updated_at();

-- ────────────────────────────────────────────────────────────
-- Seed default campaigns for existing tenants.
-- "Gruve - Ticketing" and "Sippoy - Drinks" are inserted for every
-- tenant that exists at migration time. New tenants will need their
-- own campaigns created via the UI (or a future onboarding step).
-- ────────────────────────────────────────────────────────────

insert into outreach_campaigns (tenant_slug, name, description, business)
select
  slug,
  'Gruve - Ticketing',
  'Acquire event organizers for Gruve ticketing platform',
  'gruve'
from tenants
on conflict do nothing;

insert into outreach_campaigns (tenant_slug, name, description, business)
select
  slug,
  'Sippoy - Drinks',
  'Sell drinks to events, planners and hospitality businesses',
  'sippoy'
from tenants
on conflict do nothing;

-- ────────────────────────────────────────────────────────────
-- M2M: prospect ↔ outreach_campaign
-- ────────────────────────────────────────────────────────────

create table if not exists prospect_campaigns (
  prospect_id uuid not null references prospects(id) on delete cascade,
  campaign_id uuid not null references outreach_campaigns(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (prospect_id, campaign_id)
);

create index if not exists idx_prospect_campaigns_campaign
  on prospect_campaigns(campaign_id);

alter table prospect_campaigns enable row level security;

drop policy if exists "members access prospect_campaigns" on prospect_campaigns;
create policy "members access prospect_campaigns" on prospect_campaigns
  for all using (
    exists (
      select 1 from prospects p
      where p.id = prospect_id
        and public.is_tenant_member(p.tenant_slug)
    )
  )
  with check (
    exists (
      select 1 from prospects p
      where p.id = prospect_id
        and public.is_tenant_member(p.tenant_slug)
    )
  );
