-- 114_conversation_handoffs_and_engagement_fixes.sql
-- 1. Adds thread_external_id to engagement_items and indexes it
-- 2. Backfills thread_external_id from existing external_id
-- 3. Data repair: fixes incoherent open rows (resolved_at > received_at or replied=true) and logs them
-- 4. Widens engagement_items.status check to support 'handed_off'
-- 5. Adds DB check constraint so replied=true AND status='open' cannot be persisted
-- 6. Creates conversation_handoffs table with tenant isolation and active partial unique index

-- 1. Add thread_external_id
alter table engagement_items
  add column if not exists thread_external_id text;

create index if not exists idx_engagement_items_tenant_thread
  on engagement_items(tenant_slug, thread_external_id);

create index if not exists idx_engagement_items_thread_external
  on engagement_items(thread_external_id);

-- 2. Backfill thread_external_id from external_id
update engagement_items
set thread_external_id = case
  when external_id is null then null
  when external_id ~ '^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+:[^:]+:.+$' then
    split_part(external_id, ':', 1) || ':' || split_part(external_id, ':', 2) || ':' || split_part(external_id, ':', 3)
  else external_id
end
where thread_external_id is null and external_id is not null;

-- 3. One-off data repair migration
-- For rows where resolved_at > received_at and status='open', null resolved_at.
-- Where received_at > resolved_at and status='open', set replied=false.
-- Also ensure any other open row with replied=true has replied set to false and resolved_at nulled.
do $$
declare
  r record;
begin
  for r in
    select id, tenant_slug, external_id, received_at, resolved_at, replied
    from engagement_items
    where status = 'open' and resolved_at is not null and resolved_at > received_at
  loop
    raise notice 'Data repair [resolved_at > received_at, open]: id=%, tenant=%, external_id=%, received_at=%, resolved_at=%',
      r.id, r.tenant_slug, r.external_id, r.received_at, r.resolved_at;
    update engagement_items
    set resolved_at = null
    where id = r.id;
  end loop;

  for r in
    select id, tenant_slug, external_id, received_at, resolved_at, replied
    from engagement_items
    where status = 'open' and (
      (resolved_at is not null and received_at > resolved_at)
      or replied = true
    )
  loop
    raise notice 'Data repair [open with replied=true or received_at > resolved_at]: id=%, tenant=%, external_id=%, received_at=%, resolved_at=%, replied=%',
      r.id, r.tenant_slug, r.external_id, r.received_at, r.resolved_at, r.replied;
    update engagement_items
    set replied = false, resolved_at = null
    where id = r.id;
  end loop;
end $$;

-- 4. Widen engagement_items status check to support 'handed_off'
alter table engagement_items drop constraint if exists engagement_items_status_check;
alter table engagement_items
  add constraint engagement_items_status_check
  check (status in ('open', 'snoozed', 'resolved', 'dismissed', 'archived', 'handed_off'));

-- 5. DB check constraint: replied=true AND status='open' cannot be persisted
alter table engagement_items drop constraint if exists chk_engagement_items_no_open_replied;
alter table engagement_items
  add constraint chk_engagement_items_no_open_replied
  check (not (status = 'open' and replied is true));

-- 6. New table conversation_handoffs
create table if not exists conversation_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(slug) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,
  platform text not null,
  thread_external_id text not null,
  channel text not null,
  contact text,
  note text,
  moved_by uuid not null,
  moved_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversation_handoffs_tenant_thread
  on conversation_handoffs(tenant_slug, platform, thread_external_id);

create unique index if not exists uq_conversation_handoffs_active
  on conversation_handoffs(tenant_slug, platform, thread_external_id)
  where cleared_at is null;

create unique index if not exists uq_conversation_handoffs_active_tenant_id
  on conversation_handoffs(tenant_id, platform, thread_external_id)
  where cleared_at is null;

alter table conversation_handoffs enable row level security;

drop policy if exists "members access conversation_handoffs" on conversation_handoffs;
create policy "members access conversation_handoffs" on conversation_handoffs
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
