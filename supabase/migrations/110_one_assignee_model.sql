-- Migration 110: One Assignee Model & Retire tenant_team_members
--
-- 1. Updates team_people to be the single source of truth for people/assignees:
--    - Adds role_title, tags, weekly_targets, email, and updated_at
--    - Adds unique index on (tenant_slug, user_id) where user_id is not null
-- 2. Migrates tenant_team_members rows into team_people, mapping roles to role_title
--    and tags (e.g. 'ambassador'), weekly_targets, and user_id.
-- 3. Backfills existing memberships into team_people and adds triggers for automatic
--    person creation on invite acceptance / new membership.
-- 4. Adds owner_person_id to prospects, action_items, and engagement_items.
-- 5. Backfills owner_person_id by case-insensitive name match and folds assigned_to (user_id).
-- 6. Creates unmatched_owner_strings view to list unmapped owner strings cleanly.
-- 7. Drops NOT NULL from tasks.owner_person_id and task_occurrences.owner_person_id
--    to allow unassigned one-off tasks and graceful departure unassignment.
-- 8. Implements unassign_departed_person function and departure triggers.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. team_people extensions
-- ─────────────────────────────────────────────────────────────────────────────
alter table team_people
  add column if not exists role_title text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists weekly_targets jsonb not null default '{}'::jsonb,
  add column if not exists email text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_team_people_tenant_user
  on team_people(tenant_slug, user_id)
  where user_id is not null;

create index if not exists idx_team_people_tags
  on team_people using gin(tags);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migrate tenant_team_members rows into team_people
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_person_id uuid;
  v_tags text[];
  v_role_title text;
begin
  if to_regclass('public.tenant_team_members') is not null then
    for r in select * from tenant_team_members loop
      v_tags := '{}';
      v_role_title := r.role;
      if lower(r.name) like '%ambassador%' or lower(r.role) like '%ambassador%' then
        v_tags := array['ambassador'];
        v_role_title := 'Student Ambassador';
      end if;

      -- Check if person exists by user_id or by exact case-insensitive name
      select id into v_person_id
      from team_people
      where tenant_slug = r.tenant_slug
        and (
          (r.user_id is not null and user_id = r.user_id) or
          (lower(trim(name)) = lower(trim(r.name)))
        )
      limit 1;

      if v_person_id is not null then
        update team_people
        set
          role_title = coalesce(team_people.role_title, v_role_title),
          weekly_targets = case when team_people.weekly_targets = '{}'::jsonb then r.weekly_targets else team_people.weekly_targets end,
          user_id = coalesce(team_people.user_id, r.user_id),
          active = r.active,
          tags = case when array_length(team_people.tags, 1) is null then v_tags else team_people.tags end
        where id = v_person_id;
      else
        insert into team_people (
          tenant_slug,
          name,
          role_title,
          tags,
          weekly_targets,
          user_id,
          active,
          created_at
        ) values (
          r.tenant_slug,
          r.name,
          v_role_title,
          v_tags,
          coalesce(r.weekly_targets, '{}'::jsonb),
          r.user_id,
          r.active,
          r.created_at
        );
      end if;
    end loop;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Automatic Person sync for memberships
-- ─────────────────────────────────────────────────────────────────────────────
-- 3a. Link existing unlinked team_people to memberships BEFORE inserting new rows.
-- Uses tiered deterministic matching:
-- Tier 1: exact matches on display_name, username, email prefix, or first name
--         (breaking ties in favor of owner/admin)
-- Tier 2: prefix match (e.g. "Abas" matching "Abasiubong", "Abdul" matching "Abdullahi")
-- Only links if there is a single unambiguous match for that tenant.
do $$
declare
  tp record;
  v_match_user_id uuid;
  v_match_email text;
  v_match_count int;
begin
  for tp in select * from team_people where user_id is null loop
    -- Tier 1: Exact matches (display_name, username, email prefix, or first name)
    select count(*), max(m.user_id::text)::uuid, max(u.email)
    into v_match_count, v_match_user_id, v_match_email
    from memberships m
    left join profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.tenant_slug = tp.tenant_slug
      and not exists (
        select 1 from team_people tp2
        where tp2.tenant_slug = tp.tenant_slug
          and tp2.user_id = m.user_id
          and tp2.id <> tp.id
      )
      and (
        lower(trim(tp.name)) = lower(trim(coalesce(p.display_name, ''))) or
        lower(trim(tp.name)) = lower(trim(coalesce(p.username, ''))) or
        lower(trim(tp.name)) = lower(trim(split_part(coalesce(u.email, ''), '@', 1))) or
        lower(trim(tp.name)) = lower(trim(split_part(coalesce(p.display_name, ''), ' ', 1)))
      );

    -- If multiple exact matches exist, prefer owner/admin
    if v_match_count > 1 then
      select count(*), max(m.user_id::text)::uuid, max(u.email)
      into v_match_count, v_match_user_id, v_match_email
      from memberships m
      left join profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.tenant_slug = tp.tenant_slug
        and m.role in ('owner', 'admin')
        and not exists (
          select 1 from team_people tp2
          where tp2.tenant_slug = tp.tenant_slug
            and tp2.user_id = m.user_id
            and tp2.id <> tp.id
        )
        and (
          lower(trim(tp.name)) = lower(trim(coalesce(p.display_name, ''))) or
          lower(trim(tp.name)) = lower(trim(coalesce(p.username, ''))) or
          lower(trim(tp.name)) = lower(trim(split_part(coalesce(u.email, ''), '@', 1))) or
          lower(trim(tp.name)) = lower(trim(split_part(coalesce(p.display_name, ''), ' ', 1)))
        );
    end if;

    -- Tier 2: If no exact match, try prefix/starts_with match
    if v_match_count = 0 or v_match_user_id is null then
      select count(*), max(m.user_id::text)::uuid, max(u.email)
      into v_match_count, v_match_user_id, v_match_email
      from memberships m
      left join profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.tenant_slug = tp.tenant_slug
        and not exists (
          select 1 from team_people tp2
          where tp2.tenant_slug = tp.tenant_slug
            and tp2.user_id = m.user_id
            and tp2.id <> tp.id
        )
        and (
          lower(trim(coalesce(p.display_name, ''))) like lower(trim(tp.name)) || '%' or
          lower(trim(tp.name)) like lower(trim(coalesce(p.display_name, ''))) || '%' or
          lower(trim(coalesce(p.username, ''))) like lower(trim(tp.name)) || '%' or
          lower(trim(split_part(coalesce(u.email, ''), '@', 1))) like lower(trim(tp.name)) || '%'
        );
    end if;

    if v_match_count = 1 and v_match_user_id is not null then
      update team_people
      set user_id = v_match_user_id,
          email = coalesce(team_people.email, v_match_email)
      where id = tp.id;
    end if;
  end loop;
end $$;

-- 3b. Backfill remaining memberships into team_people (only where user_id is not already linked)
insert into team_people (tenant_slug, user_id, name, email, role_title, active)
select
  m.tenant_slug,
  m.user_id,
  coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.username), ''), split_part(u.email, '@', 1), 'Team Member'),
  u.email,
  initcap(m.role),
  true
from memberships m
left join profiles p on p.id = m.user_id
left join auth.users u on u.id = m.user_id
where not exists (
  select 1 from team_people tp
  where tp.tenant_slug = m.tenant_slug and tp.user_id = m.user_id
)
on conflict (tenant_slug, user_id) where user_id is not null do update set
  name = coalesce(nullif(excluded.name, ''), team_people.name),
  email = coalesce(excluded.email, team_people.email),
  role_title = coalesce(team_people.role_title, excluded.role_title);

-- Trigger function: whenever a membership is created, link existing unlinked person or create new
create or replace function public.handle_membership_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_username text;
  v_email text;
  v_existing_id uuid;
begin
  select display_name, username into v_display_name, v_username from profiles where id = new.user_id;
  select email into v_email from auth.users where id = new.user_id;

  if v_display_name is null or trim(v_display_name) = '' then
    v_display_name := coalesce(nullif(trim(v_username), ''), split_part(v_email, '@', 1), 'Team Member');
  end if;

  -- 1. Tier 1: exact match on display_name, username, email prefix, or first name
  select id into v_existing_id
  from team_people
  where tenant_slug = new.tenant_slug
    and user_id is null
    and (
      lower(trim(name)) = lower(trim(v_display_name)) or
      (v_username is not null and lower(trim(name)) = lower(trim(v_username))) or
      (v_email is not null and lower(trim(name)) = lower(trim(split_part(v_email, '@', 1)))) or
      lower(trim(name)) = lower(trim(split_part(v_display_name, ' ', 1)))
    )
  limit 1;

  -- 2. Tier 2: prefix match if no exact match
  if v_existing_id is null then
    select id into v_existing_id
    from team_people
    where tenant_slug = new.tenant_slug
      and user_id is null
      and (
        lower(trim(v_display_name)) like lower(trim(name)) || '%' or
        lower(trim(name)) like lower(trim(v_display_name)) || '%' or
        (v_username is not null and lower(trim(v_username)) like lower(trim(name)) || '%') or
        (v_email is not null and lower(trim(split_part(v_email, '@', 1))) like lower(trim(name)) || '%')
      )
    limit 1;
  end if;

  if v_existing_id is not null then
    update team_people
    set user_id = new.user_id,
        email = coalesce(team_people.email, v_email),
        active = true
    where id = v_existing_id;
    return new;
  end if;

  insert into team_people (tenant_slug, user_id, name, email, role_title, active)
  values (
    new.tenant_slug,
    new.user_id,
    v_display_name,
    v_email,
    initcap(new.role),
    true
  )
  on conflict (tenant_slug, user_id) where user_id is not null do update set
    active = true,
    name = coalesce(nullif(excluded.name, ''), team_people.name),
    email = coalesce(excluded.email, team_people.email);

  return new;
end;
$$;

drop trigger if exists on_membership_created on memberships;
create trigger on_membership_created
  after insert on memberships
  for each row execute function public.handle_membership_created();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Add owner_person_id to prospects, action_items, engagement_items
-- ─────────────────────────────────────────────────────────────────────────────
alter table prospects
  add column if not exists owner_person_id uuid references team_people(id) on delete set null;

create index if not exists idx_prospects_tenant_owner_person
  on prospects(tenant_slug, owner_person_id);

alter table action_items
  add column if not exists owner_person_id uuid references team_people(id) on delete set null;

create index if not exists idx_action_items_tenant_owner_person
  on action_items(tenant_slug, owner_person_id);

alter table engagement_items
  add column if not exists owner_person_id uuid references team_people(id) on delete set null;

create index if not exists idx_engagement_items_tenant_owner_person
  on engagement_items(tenant_slug, owner_person_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Deterministic owner_person_id Backfill & Ambiguity Reporting
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ambiguous_owner_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null,
  source_table text not null,
  raw_owner_string text not null,
  candidate_person_ids uuid[] not null,
  candidate_names text[] not null,
  row_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Backfill action_items & engagement_items with assigned_to (user_id) directly
update action_items ai
set owner_person_id = tp.id
from team_people tp
where ai.tenant_slug = tp.tenant_slug
  and ai.owner_person_id is null
  and ai.assigned_to is not null
  and tp.user_id = ai.assigned_to;

update engagement_items ei
set owner_person_id = tp.id
from team_people tp
where ei.tenant_slug = tp.tenant_slug
  and ei.owner_person_id is null
  and ei.assigned_to is not null
  and tp.user_id = ei.assigned_to;

-- Deterministic backfill by owner string: prefer linked people, report ambiguities
create or replace function public.backfill_owner_person_ids_deterministic(p_table text)
returns void
language plpgsql
as $$
declare
  r record;
  v_linked_candidates uuid[];
  v_linked_names text[];
  v_unlinked_candidates uuid[];
  v_unlinked_names text[];
  v_count int;
begin
  for r in
    execute format(
      'select tenant_slug, owner, count(*) as cnt from %I where owner is not null and trim(owner) <> '''' and owner_person_id is null group by tenant_slug, owner',
      p_table
    )
  loop
    -- Find matching people in this tenant
    select
      coalesce(array_agg(id) filter (where user_id is not null), '{}'),
      coalesce(array_agg(name) filter (where user_id is not null), '{}'),
      coalesce(array_agg(id) filter (where user_id is null), '{}'),
      coalesce(array_agg(name) filter (where user_id is null), '{}')
    into v_linked_candidates, v_linked_names, v_unlinked_candidates, v_unlinked_names
    from team_people tp
    where tp.tenant_slug = r.tenant_slug
      and (
        lower(trim(tp.name)) = lower(trim(r.owner)) or
        lower(trim(coalesce(tp.role_title, ''))) = lower(trim(r.owner)) or
        (tp.user_id is not null and lower(trim(split_part(coalesce(tp.email, ''), '@', 1))) = lower(trim(r.owner))) or
        lower(trim(tp.name)) like lower(trim(r.owner)) || ' %' or
        lower(trim(r.owner)) like lower(trim(tp.name)) || ' %'
      );

    -- Prefer linked people
    if array_length(v_linked_candidates, 1) = 1 then
      execute format(
        'update %I set owner_person_id = $1 where tenant_slug = $2 and owner = $3 and owner_person_id is null',
        p_table
      ) using v_linked_candidates[1], r.tenant_slug, r.owner;
    elsif array_length(v_linked_candidates, 1) > 1 then
      -- Ambiguous linked candidates: do not guess. Record in diagnostic table
      insert into public.ambiguous_owner_matches (tenant_slug, source_table, raw_owner_string, candidate_person_ids, candidate_names, row_count)
      values (r.tenant_slug, p_table, r.owner, v_linked_candidates, v_linked_names, r.cnt);
    elsif array_length(v_unlinked_candidates, 1) = 1 then
      -- Single unlinked candidate
      execute format(
        'update %I set owner_person_id = $1 where tenant_slug = $2 and owner = $3 and owner_person_id is null',
        p_table
      ) using v_unlinked_candidates[1], r.tenant_slug, r.owner;
    elsif array_length(v_unlinked_candidates, 1) > 1 then
      -- Ambiguous unlinked candidates: record
      insert into public.ambiguous_owner_matches (tenant_slug, source_table, raw_owner_string, candidate_person_ids, candidate_names, row_count)
      values (r.tenant_slug, p_table, r.owner, v_unlinked_candidates, v_unlinked_names, r.cnt);
    end if;
  end loop;
end;
$$;

select public.backfill_owner_person_ids_deterministic('prospects');
select public.backfill_owner_person_ids_deterministic('action_items');
select public.backfill_owner_person_ids_deterministic('engagement_items');
drop function public.backfill_owner_person_ids_deterministic(text);

-- View of unmatched owner strings so operators can audit unmapped values cleanly
create or replace view public.unmatched_owner_strings as
select 'prospects' as source_table, tenant_slug, owner as raw_owner_string, count(*) as row_count
from prospects
where owner is not null and trim(owner) <> '' and owner_person_id is null
group by tenant_slug, owner
union all
select 'action_items' as source_table, tenant_slug, owner as raw_owner_string, count(*) as row_count
from action_items
where owner is not null and trim(owner) <> '' and owner_person_id is null
group by tenant_slug, owner
union all
select 'engagement_items' as source_table, tenant_slug, owner as raw_owner_string, count(*) as row_count
from engagement_items
where owner is not null and trim(owner) <> '' and owner_person_id is null
group by tenant_slug, owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Unassigned tasks & graceful departure handling
-- ─────────────────────────────────────────────────────────────────────────────
-- Drop NOT NULL from tasks.owner_person_id and occurrences to allow unassigned one-offs
alter table tasks alter column owner_person_id drop not null;
alter table tasks drop constraint if exists tasks_owner_person_id_fkey;
alter table tasks
  add constraint tasks_owner_person_id_fkey
  foreign key (owner_person_id) references team_people(id) on delete set null;

alter table task_occurrences alter column owner_person_id drop not null;
alter table task_occurrences drop constraint if exists task_occurrences_owner_person_id_fkey;
alter table task_occurrences
  add constraint task_occurrences_owner_person_id_fkey
  foreign key (owner_person_id) references team_people(id) on delete set null;

-- Widen queue_activity_log action check if present
do $$
begin
  if to_regclass('public.queue_activity_log') is not null then
    alter table queue_activity_log drop constraint if exists queue_activity_log_action_check;
    alter table queue_activity_log
      add constraint queue_activity_log_action_check
      check (action in ('opened','copied_reply','resolved','reopened','dismissed','snoozed','unassigned_on_departure'));
  end if;
end $$;

-- Shared unassignment function for departed or deactivated people
create or replace function public.unassign_departed_person(
  p_person_id uuid,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person record;
  v_prospect record;
  v_task record;
begin
  select * into v_person from team_people where id = p_person_id;
  if v_person.id is null then
    return;
  end if;

  -- 1. Deactivate person row
  update team_people set active = false, updated_at = now() where id = p_person_id;

  -- 2. Unassign open prospects and write note
  for v_prospect in
    select id, tenant_slug from prospects
    where owner_person_id = p_person_id
      and status not in ('closed_won', 'closed_lost', 'dismissed', 'unqualified')
  loop
    update prospects
    set owner_person_id = null, owner = null
    where id = v_prospect.id;

    insert into prospect_notes (tenant_slug, prospect_id, author_id, body)
    values (
      v_prospect.tenant_slug,
      v_prospect.id,
      p_actor_id,
      'Unassigned on departure (previous owner: ' || v_person.name || ')'
    );
  end loop;

  -- 3. Unassign open action_items and engagement_items
  update action_items
  set owner_person_id = null, owner = null, assigned_to = null
  where owner_person_id = p_person_id
    and status in ('open', 'snoozed');

  update engagement_items
  set owner_person_id = null, owner = null, assigned_to = null
  where owner_person_id = p_person_id
    and status in ('open', 'snoozed');

  -- 4. Tasks: pause recurring tasks, unassign one-offs, and clear pending occurrences
  for v_task in
    select id, kind, status, tenant_slug from tasks
    where owner_person_id = p_person_id
      and status in ('active', 'paused')
  loop
    if v_task.kind = 'recurring' then
      update tasks
      set owner_person_id = null, status = 'paused', updated_at = now()
      where id = v_task.id;
    else
      update tasks
      set owner_person_id = null, updated_at = now()
      where id = v_task.id;
    end if;

    insert into task_events (tenant_slug, task_id, actor, action, payload)
    values (
      v_task.tenant_slug,
      v_task.id,
      p_actor_id,
      'unassigned_on_departure',
      jsonb_build_object(
        'previous_owner_id', p_person_id,
        'previous_owner_name', v_person.name
      )
    );
  end loop;

  -- Clear owner from pending occurrences
  update task_occurrences
  set owner_person_id = null
  where owner_person_id = p_person_id
    and status = 'pending';

end;
$$;

-- Trigger on membership removal to unassign departed person
create or replace function public.handle_membership_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
begin
  select id into v_person_id
  from team_people
  where tenant_slug = old.tenant_slug
    and user_id = old.user_id;

  if v_person_id is not null then
    perform public.unassign_departed_person(v_person_id, auth.uid());
  end if;

  return old;
end;
$$;

drop trigger if exists on_membership_deleted on memberships;
create trigger on_membership_deleted
  after delete on memberships
  for each row execute function public.handle_membership_deleted();
