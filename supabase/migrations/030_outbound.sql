-- Slice 6 — Outbound. Replaces the `leads` module with AI-powered
-- prospect discovery + DM drafting + review queue. Priye used to do
-- this by hand; this is the system that does it for her.
--
-- Tables:
--   prospects            — the people we might DM (IG, TikTok, etc.)
--   outbound_dms         — the messages we draft/send to them
--   inbound_messages     — replies they send back, surfaced as inbox
--   prospect_searches    — saved query definitions for the discovery tab

create table if not exists prospect_searches (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  platform text not null
    check (platform in ('instagram','tiktok','twitter','linkedin','manual')),
  signal_type text not null default 'keyword'
    check (signal_type in ('keyword','hashtag','event_host','event_attendee','recent_post','manual')),
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_result_count int not null default 0,
  auto_qualify boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospect_searches_tenant
  on prospect_searches(tenant_slug);

alter table prospect_searches enable row level security;

drop policy if exists "members access prospect_searches" on prospect_searches;
create policy "members access prospect_searches" on prospect_searches
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ────────────────────────────────────────────────────

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  search_id uuid references prospect_searches(id) on delete set null,
  platform text not null
    check (platform in ('instagram','tiktok','twitter','linkedin','manual','other')),
  handle text not null,
  display_name text,
  profile_url text,
  avatar_url text,
  bio text,
  follower_count int,
  /** Why this came up — 'posted about #eventplanning 2d ago', 'hosting Afrobeats Night'. */
  signal_summary text,
  /** Raw signal payload (post URL, event name, hashtag). JSONB so we can
    evolve without migrating. */
  signal_data jsonb not null default '{}'::jsonb,
  /** AI qualifier verdict. Null = not yet scored. */
  qualification_score int check (qualification_score between 0 and 100),
  qualification_reason text,
  /** Pipeline stage. */
  status text not null default 'new'
    check (status in (
      'new',              -- freshly discovered
      'qualifying',       -- AI running
      'qualified',        -- AI scored it, waiting for us to draft
      'unqualified',      -- AI said skip
      'drafted',          -- DM drafted, awaiting human approve
      'approved',         -- human approved, queued to send
      'sent',             -- sent to platform
      'replied',          -- they responded
      'handed_off',       -- Priye took the thread over
      'closed_won',       -- booked / converted
      'closed_lost',      -- dead
      'dismissed'
    )),
  notes text,
  last_touched_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, platform, handle)
);

create index if not exists idx_prospects_tenant_status
  on prospects(tenant_slug, status, updated_at desc);

create index if not exists idx_prospects_search
  on prospects(search_id);

alter table prospects enable row level security;

drop policy if exists "members access prospects" on prospects;
create policy "members access prospects" on prospects
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_prospects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prospects_set_updated_at on prospects;
create trigger prospects_set_updated_at
  before update on prospects
  for each row execute function public.touch_prospects_updated_at();

-- ────────────────────────────────────────────────────

create table if not exists outbound_dms (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  version int not null default 1,
  body text not null,
  /** AI-suggested follow-up to send if no reply in N days. Null for no follow-up. */
  followup_body text,
  status text not null default 'drafted'
    check (status in (
      'drafted',
      'approved',
      'sent',
      'failed',
      'replied',
      'cancelled'
    )),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  external_id text,
  error text,
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outbound_dms_prospect
  on outbound_dms(prospect_id, created_at desc);

create index if not exists idx_outbound_dms_tenant_status
  on outbound_dms(tenant_slug, status, updated_at desc);

alter table outbound_dms enable row level security;

drop policy if exists "members access outbound_dms" on outbound_dms;
create policy "members access outbound_dms" on outbound_dms
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_outbound_dms_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outbound_dms_set_updated_at on outbound_dms;
create trigger outbound_dms_set_updated_at
  before update on outbound_dms
  for each row execute function public.touch_outbound_dms_updated_at();

-- ────────────────────────────────────────────────────

create table if not exists inbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  /** If we know which outbound DM this is a reply to. */
  in_reply_to_dm_id uuid references outbound_dms(id) on delete set null,
  platform text not null,
  body text not null,
  external_id text,
  received_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_messages_tenant_unread
  on inbound_messages(tenant_slug, read_at, received_at desc);

create index if not exists idx_inbound_messages_prospect
  on inbound_messages(prospect_id, received_at desc);

alter table inbound_messages enable row level security;

drop policy if exists "members access inbound_messages" on inbound_messages;
create policy "members access inbound_messages" on inbound_messages
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
