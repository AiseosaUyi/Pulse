-- Action Queue — the daily command surface (see docs/ACTION-QUEUE-BRIEF.md).
--
-- Widens the status model migration 102 added to engagement_items/
-- inbound_messages ('open'/'resolved' -> +'snoozed'/'dismissed'), adds
-- priority/due_at/proposed_reply(_author)/resolved_(at|by)/snoozed_until to
-- both, and introduces two new tables: action_items (attention that isn't a
-- message — a decision, an escalation, a pending invite) and agent_runs (a
-- run log so "new since the last run" is answerable server-side).
--
-- snoozed_until is added here even though the brief's own §3.1-A SQL draft
-- omitted it from engagement_items/inbound_messages (it only appears on the
-- action_items table below) — without it there is no way to know *when* a
-- snoozed comment/DM should reappear, which acceptance criterion 7 (snoozed
-- rows hidden then reappear) requires for exactly the highest-traffic
-- bucket ("needs a reply"). Added for parity with action_items.
--
-- action_items.uq_action_items_dedupe is deliberately a FULL (non-partial)
-- unique index, not `where dedupe_key is not null` as an earlier draft of
-- this migration had it — supabase-js's .upsert(data, {onConflict:
-- "tenant_slug,dedupe_key"}) compiles to a plain ON CONFLICT with no
-- predicate, and Postgres can't match a partial index to that. Same fix
-- already applied once in this repo for the same reason: see 057's
-- uq_engagement_items_external and 090's own_post_metrics_full_unique_index.
-- NULL dedupe_key rows never conflict with each other (Postgres treats
-- NULL <> NULL), so ad-hoc action_items without a dedupe_key are unaffected.
--
-- action_items also gets a second RLS policy beyond the brief's own draft:
-- migration 103's support-role exclusion loop only covers tables that
-- existed when 103 was written, so a support member would otherwise have
-- full read/write on every action_items row via the plain is_tenant_member
-- policy below, including 'decision'/'escalation' rows the product spec
-- says they must not see. A support member must still resolve
-- 'reply'/'follow_up' rows (unlike 103's blanket per-table exclusion), so
-- this is a narrower RESTRICTIVE policy scoped by `kind`, not a copy of
-- 103's idiom.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Widen the engagement status model.
-- ─────────────────────────────────────────────────────────────────────────
alter table engagement_items drop constraint if exists engagement_items_status_check;
alter table engagement_items
  add constraint engagement_items_status_check
  check (status in ('open','snoozed','resolved','dismissed'));

alter table engagement_items
  add column if not exists priority text not null default 'normal'
    check (priority in ('urgent','high','normal','low')),
  add column if not exists due_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists proposed_reply text,
  add column if not exists proposed_reply_author text
    check (proposed_reply_author in ('agent','human','ai_generated')),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

alter table inbound_messages drop constraint if exists inbound_messages_status_check;
alter table inbound_messages
  add constraint inbound_messages_status_check
  check (status in ('open','snoozed','resolved','dismissed'));

alter table inbound_messages
  add column if not exists priority text not null default 'normal'
    check (priority in ('urgent','high','normal','low')),
  add column if not exists due_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists proposed_reply text,
  add column if not exists proposed_reply_author text
    check (proposed_reply_author in ('agent','human','ai_generated')),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. action_items — attention that is not a message.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists action_items (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  kind text not null check (kind in
    ('reply','follow_up','decision','escalation','opportunity','chore')),
  title text not null,
  body text,
  why text,                       -- the agent's one-line reason this is on the board
  priority text not null default 'normal'
    check (priority in ('urgent','high','normal','low')),
  status text not null default 'open'
    check (status in ('open','snoozed','resolved','dismissed')),
  platform text,
  external_url text,              -- deep link the View button opens
  action_label text,              -- e.g. "Open comment", "Open DM", "Accept invite"
  proposed_reply text,
  proposed_reply_author text check (proposed_reply_author in ('agent','human','ai_generated')),
  engagement_item_id uuid references engagement_items(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  source text not null default 'agent',   -- 'agent' | 'cron' | 'human'
  source_run_id uuid,
  dedupe_key text,                -- stable key so re-running a sweep updates, not duplicates
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Full (non-partial) — see header comment. Only same-key rows conflict;
-- NULL dedupe_key rows never collide with each other.
create unique index if not exists uq_action_items_dedupe
  on action_items(tenant_slug, dedupe_key);
create index if not exists idx_action_items_board
  on action_items(tenant_slug, status, priority, due_at);

alter table action_items enable row level security;

drop policy if exists "members access action_items" on action_items;
create policy "members access action_items" on action_items
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

drop policy if exists "support restricted kinds action_items" on action_items;
create policy "support restricted kinds action_items" on action_items
  as restrictive for all
  using (not public.is_support_member(tenant_slug) or kind in ('reply','follow_up'))
  with check (not public.is_support_member(tenant_slug) or kind in ('reply','follow_up'));

create or replace function public.touch_action_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists action_items_set_updated_at on action_items;
create trigger action_items_set_updated_at
  before update on action_items
  for each row execute function public.touch_action_items_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. agent_runs — a run log, so "new since the last run" is answerable
--    server-side instead of guessed in a chat window.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  agent text not null,                  -- 'agent-social'
  surface text,                         -- 'instagram'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_runs_tenant
  on agent_runs(tenant_slug, agent, started_at desc);

alter table agent_runs enable row level security;
drop policy if exists "members access agent_runs" on agent_runs;
create policy "members access agent_runs" on agent_runs
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
