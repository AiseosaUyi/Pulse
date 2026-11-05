-- Migration 112: Tasks Security, Support Exclusions, Storage Policies & Constraints
--
-- This migration is additive and safe to run BEFORE deploying new code:
-- 1. Restrictive support-role exclusion policies on Tasks tables:
--    tasks, task_checklist_items, task_occurrences, task_occurrence_checks,
--    task_comments, person_leave, task_events.
--    NOTE: team_people is EXCLUDED from restrictive support exclusion so support
--    can see who conversations and leads are assigned to in the Inbox/Conversations queues.
-- 2. Tenant-scoped and support-excluded storage policies on 'task-proofs' bucket:
--    Restricts storage access to the caller's tenant folder: (storage.foldername(name))[1].
-- 3. Updates tasks.created_by, task_comments.author, and person_leave.created_by
--    foreign keys to ON DELETE SET NULL so user deletion does not wipe history.
-- 4. Extends person_leave with status ('requested','approved','declined','cancelled'),
--    review audit fields, and starts_on <= ends_on constraint (added NOT VALID, then validated).
-- 5. Observable pre-cleanup table + audit notices for dirty rows.
-- 6. Adds database CHECK constraints on tasks with pre-cleanup and NOT VALID then validated:
--    - Schedule requirement (kind = 'one_off' -> due_date; kind = 'recurring' -> recurrence)
--    - Valid date range (end_date >= start_date)
--    - Weekly tasks have non-empty recurrence_days
--    - Recurring tasks require an owner unless paused

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restrictive Support-Role Policies (Excludes team_people)
-- ─────────────────────────────────────────────────────────────────────────────
-- Ensure team_people does NOT have a restrictive support exclusion
drop policy if exists "support excluded from team_people" on team_people;

do $$
declare t text;
begin
  -- Restrictive exclusion on tasks business tables (excludes support users)
  foreach t in array array[
    'tasks',
    'task_checklist_items',
    'task_occurrences',
    'task_occurrence_checks',
    'task_comments',
    'person_leave',
    'task_events'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'tasks security migration: skipping %, table does not exist', t;
      continue;
    end if;

    execute format('drop policy if exists "support excluded from %1$s" on %1$I', t);
    execute format(
      'create policy "support excluded from %1$s" on %1$I as restrictive for all using (not public.is_support_member(tenant_slug)) with check (not public.is_support_member(tenant_slug))',
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Storage Bucket Security for task-proofs
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "members upload task-proofs" on storage.objects;
drop policy if exists "members read task-proofs" on storage.objects;
drop policy if exists "tenant members upload task-proofs" on storage.objects;
drop policy if exists "tenant members read task-proofs" on storage.objects;
drop policy if exists "tenant members update task-proofs" on storage.objects;
drop policy if exists "tenant members delete task-proofs" on storage.objects;

create policy "tenant members upload task-proofs" on storage.objects
  for insert with check (
    bucket_id = 'task-proofs' and
    public.is_tenant_member((storage.foldername(name))[1]) and
    not public.is_support_member((storage.foldername(name))[1])
  );

create policy "tenant members read task-proofs" on storage.objects
  for select using (
    bucket_id = 'task-proofs' and
    public.is_tenant_member((storage.foldername(name))[1]) and
    not public.is_support_member((storage.foldername(name))[1])
  );

create policy "tenant members update task-proofs" on storage.objects
  for update using (
    bucket_id = 'task-proofs' and
    public.is_tenant_member((storage.foldername(name))[1]) and
    not public.is_support_member((storage.foldername(name))[1])
  );

create policy "tenant members delete task-proofs" on storage.objects
  for delete using (
    bucket_id = 'task-proofs' and
    public.is_tenant_member((storage.foldername(name))[1]) and
    not public.is_support_member((storage.foldername(name))[1])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Change CASCADE to SET NULL on user foreign keys
-- ─────────────────────────────────────────────────────────────────────────────
-- tasks.created_by
alter table tasks alter column created_by drop not null;
alter table tasks drop constraint if exists tasks_created_by_fkey;
alter table tasks
  add constraint tasks_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- task_comments.author
alter table task_comments alter column author drop not null;
alter table task_comments drop constraint if exists task_comments_author_fkey;
alter table task_comments
  add constraint task_comments_author_fkey
  foreign key (author) references auth.users(id) on delete set null;

-- person_leave.created_by
alter table person_leave alter column created_by drop not null;
alter table person_leave drop constraint if exists person_leave_created_by_fkey;
alter table person_leave
  add constraint person_leave_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Observable Pre-cleanup Audit Table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.migration_112_precleanup_log (
  id uuid,
  tenant_slug text,
  table_name text not null,
  record_identifier text,
  change_description text not null,
  logged_at timestamptz not null default now()
);

alter table public.migration_112_precleanup_log enable row level security;
revoke all on public.migration_112_precleanup_log from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. person_leave workflow & validation
-- ─────────────────────────────────────────────────────────────────────────────
alter table person_leave
  add column if not exists status text not null default 'approved'
    check (status in ('requested', 'approved', 'declined', 'cancelled')),
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- 5b. Pre-cleanup & date check on person_leave (with observable logging)
do $$
declare
  r record;
  cnt int := 0;
begin
  for r in (select id, tenant_slug, person_id, starts_on, ends_on from person_leave where ends_on < starts_on) loop
    insert into public.migration_112_precleanup_log (id, tenant_slug, table_name, record_identifier, change_description)
    values (r.id, r.tenant_slug, 'person_leave', r.person_id::text, format('ends_on (%s) < starts_on (%s) -> set ends_on = starts_on', r.ends_on, r.starts_on));
    cnt := cnt + 1;
  end loop;

  raise notice 'Migration 112 pre-cleanup: % person_leave row(s) updated for ends_on < starts_on', cnt;
end $$;

update person_leave
set ends_on = starts_on
where ends_on < starts_on;

alter table person_leave drop constraint if exists person_leave_dates_check;
alter table person_leave
  add constraint person_leave_dates_check
  check (starts_on <= ends_on) not valid;
alter table person_leave validate constraint person_leave_dates_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DB CHECK constraints on tasks with observable pre-cleanup and NOT VALID validation
-- ─────────────────────────────────────────────────────────────────────────────
-- 6a. Pre-cleanup any dirty existing task rows (observable logging into table and notice)
do $$
declare
  r record;
  c_due int := 0;
  c_rec int := 0;
  c_end int := 0;
  c_days int := 0;
  c_pause int := 0;
begin
  -- 1. One-off tasks missing due_date
  for r in (select id, tenant_slug, title, start_date from tasks where kind = 'one_off' and due_date is null) loop
    insert into public.migration_112_precleanup_log (id, tenant_slug, table_name, record_identifier, change_description)
    values (r.id, r.tenant_slug, 'tasks', r.title, format('one_off task missing due_date -> set due_date to start_date (%s)', r.start_date));
    c_due := c_due + 1;
  end loop;

  -- 2. Recurring tasks missing recurrence
  for r in (select id, tenant_slug, title from tasks where kind = 'recurring' and recurrence is null) loop
    insert into public.migration_112_precleanup_log (id, tenant_slug, table_name, record_identifier, change_description)
    values (r.id, r.tenant_slug, 'tasks', r.title, 'recurring task missing recurrence -> set recurrence = daily');
    c_rec := c_rec + 1;
  end loop;

  -- 3. Tasks where end_date < start_date
  for r in (select id, tenant_slug, title, start_date, end_date from tasks where end_date is not null and end_date < start_date) loop
    insert into public.migration_112_precleanup_log (id, tenant_slug, table_name, record_identifier, change_description)
    values (r.id, r.tenant_slug, 'tasks', r.title, format('end_date (%s) < start_date (%s) -> set end_date = start_date', r.end_date, r.start_date));
    c_end := c_end + 1;
  end loop;

  -- 4. Weekly tasks missing recurrence_days
  for r in (select id, tenant_slug, title from tasks where recurrence = 'weekly' and (recurrence_days is null or array_length(recurrence_days, 1) = 0)) loop
    insert into public.migration_112_precleanup_log (id, tenant_slug, table_name, record_identifier, change_description)
    values (r.id, r.tenant_slug, 'tasks', r.title, 'weekly task missing recurrence_days -> set [1,2,3,4,5]');
    c_days := c_days + 1;
  end loop;

  -- 5. Recurring tasks without owner that are not paused
  for r in (select id, tenant_slug, title from tasks where kind = 'recurring' and owner_person_id is null and status <> 'paused') loop
    insert into public.migration_112_precleanup_log (id, tenant_slug, table_name, record_identifier, change_description)
    values (r.id, r.tenant_slug, 'tasks', r.title, 'unowned recurring task active -> set status = paused');
    c_pause := c_pause + 1;
  end loop;

  raise notice 'Migration 112 tasks pre-cleanup summary: % missing due_date, % missing recurrence, % invalid end_date, % missing weekdays, % unowned paused',
    c_due, c_rec, c_end, c_days, c_pause;
end $$;

update tasks
set due_date = coalesce(due_date, start_date)
where kind = 'one_off' and due_date is null;

update tasks
set recurrence = 'daily'
where kind = 'recurring' and recurrence is null;

update tasks
set end_date = start_date
where end_date is not null and end_date < start_date;

update tasks
set recurrence_days = array[1,2,3,4,5]
where recurrence = 'weekly' and (recurrence_days is null or array_length(recurrence_days, 1) = 0);

update tasks
set status = 'paused'
where kind = 'recurring' and owner_person_id is null and status <> 'paused';

-- 6b. Add constraints NOT VALID first, then validate
-- Recurring tasks need recurrence, one-off tasks need due_date
alter table tasks drop constraint if exists tasks_schedule_check;
alter table tasks
  add constraint tasks_schedule_check
  check (
    (kind = 'one_off' and due_date is not null) or
    (kind = 'recurring' and recurrence is not null)
  ) not valid;
alter table tasks validate constraint tasks_schedule_check;

-- end_date >= start_date
alter table tasks drop constraint if exists tasks_dates_check;
alter table tasks
  add constraint tasks_dates_check
  check (end_date is null or end_date >= start_date) not valid;
alter table tasks validate constraint tasks_dates_check;

-- Weekly tasks need recurrence_days
alter table tasks drop constraint if exists tasks_weekly_days_check;
alter table tasks
  add constraint tasks_weekly_days_check
  check (
    recurrence is distinct from 'weekly' or
    (recurrence_days is not null and array_length(recurrence_days, 1) > 0)
  ) not valid;
alter table tasks validate constraint tasks_weekly_days_check;

-- Recurring tasks without an owner must be paused
alter table tasks drop constraint if exists tasks_recurring_owner_check;
alter table tasks
  add constraint tasks_recurring_owner_check
  check (
    kind = 'one_off' or
    owner_person_id is not null or
    status = 'paused'
  ) not valid;
alter table tasks validate constraint tasks_recurring_owner_check;
