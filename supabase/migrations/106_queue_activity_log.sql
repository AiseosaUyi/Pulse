-- Queue activity log — replaces the Action Queue's manual "Assign to
-- me"/"Snooze" UI ceremony with observability instead: every open, copy
-- reply, and resolve/reopen a team member does on a queue row is recorded
-- (who, when, and a snapshot of what the message said at the time), so a
-- small team can see who handled what without needing a claim/lock step.
-- Restricted to owner/admin — same bar as inviting teammates or managing
-- connected_accounts, not member/support.
--
-- `assigned_to`/snooze columns (migration 105) are left in place —
-- unused by this UI now, but still available to an agent over MCP/API if
-- useful there. Nothing here removes that capability, only the human UI
-- affordance for it.

create table if not exists queue_activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  row_source text not null check (row_source in ('engagement','action','coach','prospect')),
  row_id uuid not null,
  action text not null check (action in ('opened','copied_reply','resolved','reopened','dismissed','snoozed')),
  actor_id uuid references auth.users(id) on delete set null,
  -- What the message/DM said at the time of the action — the row's own
  -- content can change (proposed_reply edited, item re-observed) or the
  -- row itself can later be deleted, so this is captured, not referenced.
  content_snapshot text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_queue_activity_log_row
  on queue_activity_log(tenant_slug, row_source, row_id, created_at desc);
create index if not exists idx_queue_activity_log_tenant
  on queue_activity_log(tenant_slug, created_at desc);

alter table queue_activity_log enable row level security;

-- Anyone on the tenant can log their OWN action (the write happens as a
-- side effect of the human clicking View/Copy/Resolve) — this is an
-- append-only audit trail, not something a member should be able to read
-- back to see who else looked at what.
drop policy if exists "members log own queue activity" on queue_activity_log;
create policy "members log own queue activity" on queue_activity_log
  for insert
  with check (public.is_tenant_member(tenant_slug) and actor_id = auth.uid());

-- Only owner/admin can read the log.
drop policy if exists "owners and admins read queue activity" on queue_activity_log;
create policy "owners and admins read queue activity" on queue_activity_log
  for select
  using (public.tenant_role(tenant_slug) in ('owner', 'admin'));
