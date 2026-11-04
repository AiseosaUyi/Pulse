-- Migration 108: My Day, Prospect Owners & Team Roster
--
-- 1. Adds real 'owner' and 'priority' columns to prospects table,
--    backfilled from signal_data->>'owner' and signal_data->>'priority'
--    while leaving signal_data intact.
-- 2. Adds 'owner' column to action_items and engagement_items.
-- 3. Adds tenant_team_members table for outbound and sales team roster,
--    seeded for tenant 'gruve' (Aise, Abas, Abdul, Olamide, Ambassador 1, Ambassador 2)
--    and tenant 'sippy'.
-- 4. Widens action_items and engagement_items status check to support 'archived'.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Prospects: owner & priority
-- ─────────────────────────────────────────────────────────────────────────
alter table prospects add column if not exists owner text;
alter table prospects add column if not exists priority text;

create index if not exists idx_prospects_tenant_owner
  on prospects(tenant_slug, owner);

create index if not exists idx_prospects_tenant_priority
  on prospects(tenant_slug, priority);

-- Backfill from signal_data without touching signal_data
update prospects
set owner = signal_data->>'owner'
where owner is null and signal_data->>'owner' is not null;

update prospects
set priority = signal_data->>'priority'
where priority is null and signal_data->>'priority' is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Action items & engagement items: owner & archived status
-- ─────────────────────────────────────────────────────────────────────────
alter table action_items add column if not exists owner text;
alter table engagement_items add column if not exists owner text;

create index if not exists idx_action_items_tenant_owner
  on action_items(tenant_slug, owner);

create index if not exists idx_engagement_items_tenant_owner
  on engagement_items(tenant_slug, owner);

-- Widen status check to include 'archived'
alter table action_items drop constraint if exists action_items_status_check;
alter table action_items
  add constraint action_items_status_check
  check (status in ('open','snoozed','resolved','dismissed','archived'));

alter table engagement_items drop constraint if exists engagement_items_status_check;
alter table engagement_items
  add constraint engagement_items_status_check
  check (status in ('open','snoozed','resolved','dismissed','archived'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. tenant_team_members table
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists tenant_team_members (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  role text not null,
  active boolean not null default true,
  weekly_targets jsonb not null default '{}'::jsonb,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tenant_team_members_tenant_name unique (tenant_slug, name)
);

create index if not exists idx_tenant_team_members_tenant
  on tenant_team_members(tenant_slug, active);

alter table tenant_team_members enable row level security;

drop policy if exists "members access tenant_team_members" on tenant_team_members;
create policy "members access tenant_team_members" on tenant_team_members
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- Seed Gruve tenant roster with default weekly targets
insert into tenant_team_members (tenant_slug, name, role, active, weekly_targets)
values
  ('gruve', 'Aise', 'Founder / Admin', true, '{"eventsCreated": 0, "conversations": 0, "reachOuts": 0, "organicDms": 0}'::jsonb),
  ('gruve', 'Abas', 'Head of Marketing', true, '{"eventsCreated": 25, "conversations": 0, "reachOuts": 0, "organicDms": 0}'::jsonb),
  ('gruve', 'Abdul', 'Partnerships and BD', true, '{"eventsCreated": 0, "conversations": 40, "reachOuts": 0, "organicDms": 0}'::jsonb),
  ('gruve', 'Olamide', 'Social Media', true, '{"eventsCreated": 0, "conversations": 0, "reachOuts": 0, "organicDms": 20}'::jsonb),
  ('gruve', 'Ambassador 1', 'Student Ambassador', true, '{"eventsCreated": 0, "conversations": 0, "reachOuts": 100, "organicDms": 0}'::jsonb),
  ('gruve', 'Ambassador 2', 'Student Ambassador', true, '{"eventsCreated": 0, "conversations": 0, "reachOuts": 100, "organicDms": 0}'::jsonb)
on conflict (tenant_slug, name) do update set
  role = excluded.role,
  weekly_targets = excluded.weekly_targets;

-- Seed Sippy tenant roster with default founder member
insert into tenant_team_members (tenant_slug, name, role, active, weekly_targets)
values
  ('sippy', 'Aise', 'Founder / Admin', true, '{"eventsCreated": 0, "conversations": 0, "reachOuts": 0, "organicDms": 0}'::jsonb)
on conflict (tenant_slug, name) do nothing;
