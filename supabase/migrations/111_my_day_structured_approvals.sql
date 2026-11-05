-- Migration 111: My Day Structured Approvals, Waiting On Field & Auto-Generated Flags
--
-- 1. Adds structured approval columns to prospects:
--    approved_message, approved_channel, approved_contact, approved_by, approved_at
-- 2. Adds is_auto_generated boolean flag to prospects (replacing dec26-* prefix regex)
-- 3. Adds status_updated_at to prospects and a trigger to touch it only on real status changes
--    (preventing owner/priority edits from bumping won/handed_off counts on the scoreboard)
-- 4. Adds waiting_on_person_id to engagement_items, inbound_messages, and action_items
--    (replacing fragile /do not send/i text checks with a named assignee)
-- 5. Backfills approved fields by parsing legacy prospect_notes once.
-- 6. Backfills is_auto_generated for legacy 'dec26-%' handles.
-- 7. Adds performance indexes for scoreboard queries.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Prospects structured approval & status tracking columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table prospects
  add column if not exists approved_message text,
  add column if not exists approved_channel text,
  add column if not exists approved_contact text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_by_person_id uuid references team_people(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists is_auto_generated boolean not null default false,
  add column if not exists status_updated_at timestamptz;

-- Backfill status_updated_at from updated_at, then created_at BEFORE setting not null & default
-- This ensures existing won/handed_off leads preserve their true historical timestamps
-- rather than all being counted as won during the migration week.
update prospects
set status_updated_at = coalesce(updated_at, created_at, now())
where status_updated_at is null;

-- Now set default and not null
alter table prospects
  alter column status_updated_at set default now(),
  alter column status_updated_at set not null;

create index if not exists idx_prospects_tenant_status_updated
  on prospects(tenant_slug, status, status_updated_at);

-- Trigger to maintain status_updated_at only when status changes
create or replace function public.touch_prospect_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.status_updated_at = coalesce(new.status_updated_at, now());
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    new.status_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists prospects_set_status_updated_at on prospects;
create trigger prospects_set_status_updated_at
  before insert or update on prospects
  for each row execute function public.touch_prospect_status_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. waiting_on_person_id on action surfaces
-- ─────────────────────────────────────────────────────────────────────────────
alter table engagement_items
  add column if not exists waiting_on_person_id uuid references team_people(id) on delete set null;

create index if not exists idx_engagement_items_waiting_on
  on engagement_items(tenant_slug, waiting_on_person_id)
  where waiting_on_person_id is not null;

alter table inbound_messages
  add column if not exists waiting_on_person_id uuid references team_people(id) on delete set null;

create index if not exists idx_inbound_messages_waiting_on
  on inbound_messages(tenant_slug, waiting_on_person_id)
  where waiting_on_person_id is not null;

alter table action_items
  add column if not exists waiting_on_person_id uuid references team_people(id) on delete set null;

create index if not exists idx_action_items_waiting_on
  on action_items(tenant_slug, waiting_on_person_id)
  where waiting_on_person_id is not null;

-- Ensure outbound_dms index covers sent_at
create index if not exists idx_outbound_dms_tenant_sent_at
  on outbound_dms(tenant_slug, status, sent_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. One-time backfill of structured fields
-- ─────────────────────────────────────────────────────────────────────────────
-- Flag auto-generated handles
update prospects
set is_auto_generated = true
where handle like 'dec26-%';

-- Backfill initial status_updated_at from updated_at / created_at
update prospects
set status_updated_at = coalesce(updated_at, created_at, now())
where status_updated_at is null;

-- Backfill approved fields from legacy notes
do $$
declare
  n record;
  v_lines text[];
  v_header text;
  v_msg text;
  v_chan text := 'Manual';
  v_contact text := '';
  v_sender text := null;
  v_person_id uuid;
begin
  if to_regclass('public.prospect_notes') is not null then
    for n in
      execute 'select id, tenant_slug, prospect_id, body, created_by, created_at from prospect_notes where body ilike ''First message, approved by%'' order by created_at asc'
    loop
      v_lines := regexp_split_to_array(n.body, E'\n\\s*\n');
      v_header := coalesce(v_lines[1], '');
      if array_length(v_lines, 1) > 1 then
        v_msg := trim(array_to_string(v_lines[2:array_length(v_lines, 1)], E'\n\n'));
      else
        v_msg := n.body;
      end if;

      -- Channel match
      if v_header ~* 'Channel\s+WhatsApp' then
        v_chan := 'WhatsApp';
        v_contact := trim(regexp_replace(v_header, '(?i).*Channel\s+WhatsApp\s*([^.\n]*).*', '\1'));
      elsif v_header ~* 'Channel\s+Instagram' then
        v_chan := 'Instagram';
        v_contact := trim(regexp_replace(v_header, '(?i).*Channel\s+Instagram(\s+DM\s+to)?\s*([^.\n]*).*', '\2'));
      elsif v_header ~* 'Channel\s+Email' then
        v_chan := 'Email';
        v_contact := trim(regexp_replace(v_header, '(?i).*Channel\s+Email\s*([^.\n]*).*', '\1'));
      else
        v_chan := 'Manual';
        v_contact := '';
      end if;

      -- Approver / sender
      if v_header ~* 'Sender\s+([^.]+)\.' then
        v_sender := trim(regexp_replace(v_header, '(?i).*Sender\s+([^.]+)\..*', '\1'));
        select id into v_person_id
        from team_people
        where tenant_slug = n.tenant_slug and lower(trim(name)) = lower(v_sender)
        limit 1;
      else
        v_person_id := null;
      end if;

      update prospects
      set
        approved_message = coalesce(prospects.approved_message, v_msg),
        approved_channel = coalesce(prospects.approved_channel, v_chan),
        approved_contact = coalesce(prospects.approved_contact, nullif(v_contact, '')),
        approved_by = coalesce(prospects.approved_by, n.created_by),
        approved_by_person_id = coalesce(prospects.approved_by_person_id, v_person_id),
        approved_at = coalesce(prospects.approved_at, n.created_at)
      where id = n.prospect_id;
    end loop;
  end if;
end $$;

-- Backfill legacy "do not send" waiting on person (dynamically resolved to tenant owner)
do $$
declare
  r record;
  v_owner_person_id uuid;
begin
  for r in select distinct tenant_slug from action_items loop
    select tp.id into v_owner_person_id
    from team_people tp
    join memberships m on m.user_id = tp.user_id and m.tenant_slug = tp.tenant_slug
    where tp.tenant_slug = r.tenant_slug and m.role in ('owner', 'admin')
    order by (case when m.role = 'owner' then 0 else 1 end), tp.created_at asc
    limit 1;

    if v_owner_person_id is not null then
      update action_items
      set waiting_on_person_id = v_owner_person_id
      where tenant_slug = r.tenant_slug
        and waiting_on_person_id is null
        and kind = 'reply'
        and (why ilike '%do not send%' or body ilike '%do not send%');

      update engagement_items
      set waiting_on_person_id = v_owner_person_id
      where tenant_slug = r.tenant_slug
        and waiting_on_person_id is null
        and (why ilike '%do not send%' or body ilike '%do not send%');

      update inbound_messages
      set waiting_on_person_id = v_owner_person_id
      where tenant_slug = r.tenant_slug
        and waiting_on_person_id is null
        and body ilike '%do not send%';
    end if;
  end loop;
end $$;
