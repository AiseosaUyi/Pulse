-- Outreach Intelligence — Phase 1
-- AI conversation analysis results per prospect. Every time a new
-- inbound message is recorded or a DM is marked sent, AI runs on the
-- full thread and writes a row here. The latest row per prospect is
-- what the thread view and command center display.
-- AI-suggested follow_up_at is auto-applied to prospects.follow_up_at
-- immediately on insert (see trigger below).

create table if not exists conversation_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  /** What event triggered this analysis run. */
  trigger_type text not null check (trigger_type in (
    'inbound_message',  -- new reply recorded
    'dm_sent',          -- outbound DM marked sent
    'manual',           -- employee clicked "Analyze"
    'backfill',         -- one-time retroactive backfill cron
    'import'            -- CSV import enrichment
  )),
  /** FK to the triggering record, if applicable. */
  trigger_id uuid,
  -- ── Conversation stage ──────────────────────────────────
  conversation_stage text not null check (conversation_stage in (
    'initial_contact',    -- we reached out, no reply yet
    'interested',         -- they replied positively
    'objecting',          -- price, timing, existing provider, etc.
    'follow_up_requested',-- they said "reach out after X"
    'cold',               -- no activity, going stale
    'converted',          -- booked / became a customer
    'lost'                -- dead, closed
  )),
  intent_summary text not null,              -- 1-sentence plain-English summary
  -- ── Follow-up recommendation ────────────────────────────
  recommended_follow_up_at timestamptz,      -- AI-derived date (auto-applied)
  recommended_follow_up_note text,           -- "Reach out after their June 15 event"
  recommended_wait_days int,                 -- 0|3|7|14|30|60|90
  -- ── Risk + objection ────────────────────────────────────
  objection_detected boolean not null default false,
  objection_category text check (objection_category in (
    'existing_provider', 'timing', 'price',
    'no_response', 'not_interested', 'other'
  )),
  risk_level text not null default 'low' check (risk_level in (
    'low', 'medium', 'high', 'dead'
  )),
  -- ── Business opportunity flags ────────────────────────────
  gruve_relevant boolean not null default false,
  sippoy_relevant boolean not null default false,
  -- ── AI provenance ───────────────────────────────────────
  model text,
  cost_usd numeric(8,4) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_conv_analyses_prospect_recent
  on conversation_analyses(prospect_id, created_at desc);

create index if not exists idx_conv_analyses_tenant_recent
  on conversation_analyses(tenant_slug, created_at desc);

alter table conversation_analyses enable row level security;

drop policy if exists "members access conversation_analyses" on conversation_analyses;
create policy "members access conversation_analyses" on conversation_analyses
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─── Auto-apply trigger ─────────────────────────────────────────
-- When a new analysis is inserted with a recommended_follow_up_at,
-- immediately write it to prospects.follow_up_at and follow_up_note.
-- This satisfies the decision: AI follow-up date auto-applies.
-- If the prospect is already closed/dismissed we skip the update.

create or replace function public.apply_conversation_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recommended_follow_up_at is not null then
    update prospects
    set
      follow_up_at   = new.recommended_follow_up_at,
      follow_up_note = new.recommended_follow_up_note,
      updated_at     = now()
    where id = new.prospect_id
      and status not in ('closed_won', 'closed_lost', 'dismissed', 'unqualified');
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_analysis_auto_apply on conversation_analyses;
create trigger conversation_analysis_auto_apply
  after insert on conversation_analyses
  for each row execute function public.apply_conversation_analysis();
