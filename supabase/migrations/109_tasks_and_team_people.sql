-- Pulse Tasks — Team task tracker with daily recurring tasks, checklists,
-- proof verification, and accountability tracking (misses, streaks, standups).
--
-- Migration 109:
--   1. Adds timezone column to tenants table (default 'Africa/Lagos')
--   2. Creates team_people (assignees with or without login)
--   3. Creates tasks (task definitions with recurrence, proof, metrics)
--   4. Creates task_checklist_items (checklist templates)
--   5. Creates task_occurrences (dated task instances with status, proof, metrics)
--   6. Creates task_occurrence_checks (occurrence-specific checklist states)
--   7. Creates task_comments (comment thread per task/occurrence)
--   8. Creates person_leave (leave dates marking occurrences as skipped)
--   9. Creates task_events (append-only audit log)
--  10. Sets up task-proofs private storage bucket for proof image uploads
--  11. Adds indexes and RLS policies enforcing tenant isolation

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tenant timezone
-- ─────────────────────────────────────────────────────────────────────────
alter table tenants
  add column if not exists timezone text not null default 'Africa/Lagos';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. team_people — team members and ambassadors (with or without login)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists team_people (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  user_id uuid references auth.users(id) on delete set null,
  lead_person_id uuid references team_people(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_people_tenant on team_people(tenant_slug, active);
create index if not exists idx_team_people_user on team_people(user_id) where user_id is not null;

alter table team_people enable row level security;

drop policy if exists "members manage team_people" on team_people;
create policy "members manage team_people" on team_people
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. tasks — definition of one-off and recurring tasks
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  title text not null,
  description text,
  owner_person_id uuid not null references team_people(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  kind text not null check (kind in ('one_off','recurring')),
  -- schedule
  start_date date not null,
  end_date date,
  due_date date,
  due_time time,
  recurrence text check (recurrence in ('daily','weekdays','weekly','monthly')),
  recurrence_days smallint[],
  recurrence_month_day smallint,
  -- proof and measurement
  proof_required text not null default 'none' check (proof_required in ('none','link','note','image')),
  proof_hint text,
  metric_label text,
  metric_target numeric,
  -- links into the rest of Pulse
  linked_type text check (linked_type is null or linked_type in ('prospect','event','post','campaign')),
  linked_id uuid,
  status text not null default 'active' check (status in ('active','paused','archived')),
  paused_until date,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_tenant on tasks(tenant_slug, status);
create index if not exists idx_tasks_owner on tasks(tenant_slug, owner_person_id);

alter table tasks enable row level security;

drop policy if exists "members manage tasks" on tasks;
create policy "members manage tasks" on tasks
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function public.touch_tasks_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. task_checklist_items — checklist template per task
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  position int not null,
  label text not null
);

create index if not exists idx_task_checklist_items_task on task_checklist_items(task_id, position);

alter table task_checklist_items enable row level security;

drop policy if exists "members manage task_checklist_items" on task_checklist_items;
create policy "members manage task_checklist_items" on task_checklist_items
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 5. task_occurrences — dated instances of tasks
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists task_occurrences (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  owner_person_id uuid not null references team_people(id) on delete cascade,
  occurs_on date not null,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','done','missed','excused','skipped')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_late boolean not null default false,
  proof_url text,
  proof_note text,
  proof_image_path text,
  metric_value numeric,
  excused_by uuid references auth.users(id) on delete set null,
  excused_reason text,
  created_at timestamptz not null default now(),
  unique (task_id, occurs_on)
);

create index if not exists idx_task_occurrences_tenant_occurs on task_occurrences (tenant_slug, occurs_on);
create index if not exists idx_task_occurrences_tenant_owner_occurs on task_occurrences (tenant_slug, owner_person_id, occurs_on);
create index if not exists idx_task_occurrences_pending_missed on task_occurrences (tenant_slug, status) where status in ('pending','missed');

alter table task_occurrences enable row level security;

drop policy if exists "members manage task_occurrences" on task_occurrences;
create policy "members manage task_occurrences" on task_occurrences
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 6. task_occurrence_checks — checklist checks on each occurrence
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists task_occurrence_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  occurrence_id uuid not null references task_occurrences(id) on delete cascade,
  position int not null,
  label text not null,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_task_occurrence_checks_occ on task_occurrence_checks(occurrence_id, position);

alter table task_occurrence_checks enable row level security;

drop policy if exists "members manage task_occurrence_checks" on task_occurrence_checks;
create policy "members manage task_occurrence_checks" on task_occurrence_checks
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 7. task_comments — comment threads on tasks and occurrences
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  occurrence_id uuid references task_occurrences(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_comments_task on task_comments(task_id, created_at desc);

alter table task_comments enable row level security;

drop policy if exists "members manage task_comments" on task_comments;
create policy "members manage task_comments" on task_comments
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 8. person_leave — planned leave windows that turn days into skipped
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists person_leave (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  person_id uuid not null references team_people(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_person_leave_person on person_leave(tenant_slug, person_id, starts_on, ends_on);

alter table person_leave enable row level security;

drop policy if exists "members manage person_leave" on person_leave;
create policy "members manage person_leave" on person_leave
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 9. task_events — append-only audit trail
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists task_events (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  occurrence_id uuid references task_occurrences(id) on delete set null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_events_tenant_task on task_events (tenant_slug, task_id, created_at desc);
create index if not exists idx_task_events_occurrence on task_events (occurrence_id);

alter table task_events enable row level security;

drop policy if exists "members read task_events" on task_events;
create policy "members read task_events" on task_events
  for select using (public.is_tenant_member(tenant_slug));

drop policy if exists "members insert task_events" on task_events;
create policy "members insert task_events" on task_events
  for insert with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Private storage bucket for proof images (capped at 5 MB)
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-proofs',
  'task-proofs',
  false,
  5242880, -- 5 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members upload task-proofs" on storage.objects;
create policy "members upload task-proofs" on storage.objects
  for insert with check (
    bucket_id = 'task-proofs' and
    auth.role() = 'authenticated'
  );

drop policy if exists "members read task-proofs" on storage.objects;
create policy "members read task-proofs" on storage.objects
  for select using (
    bucket_id = 'task-proofs' and
    auth.role() = 'authenticated'
  );
