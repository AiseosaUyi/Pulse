-- Atomic state transitions for video_projects. Same optimistic-version +
-- audit-in-one-transaction discipline as transition_blog_post_status (mig 044).
-- Caller passes expected_version; a mismatch raises version_conflict (40001).

create table if not exists video_project_status_audit (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references video_projects(id) on delete cascade,
  from_status text not null,
  to_status   text not null,
  actor       uuid references auth.users(id) on delete set null,
  reason      text,
  decided_at  timestamptz not null default now()
);
create index if not exists idx_video_project_status_audit_project
  on video_project_status_audit(project_id, decided_at desc);

alter table video_project_status_audit enable row level security;
drop policy if exists "members read video_status_audit" on video_project_status_audit;
create policy "members read video_status_audit" on video_project_status_audit
  for select using (
    exists (
      select 1 from video_projects p
      where p.id = video_project_status_audit.project_id
        and public.is_tenant_member(p.tenant_slug)
    )
  );

create or replace function public.transition_video_project_status(
  p_project_id        uuid,
  p_from_status       text,
  p_to_status         text,
  p_expected_version  int,
  p_actor             uuid default null,
  p_reason            text default null
)
returns table (id uuid, new_status text, new_version int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  text;
  v_role    text;
  v_allowed boolean;
begin
  select tenant_slug into v_tenant
  from video_projects
  where video_projects.id = p_project_id
  for update;

  if v_tenant is null then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if not public.is_tenant_member(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_role := public.tenant_role(v_tenant);

  v_allowed := case
    when p_from_status = 'draft'              and p_to_status = 'in_review'         then true
    when p_from_status = 'in_review'          and p_to_status = 'approved'          then v_role in ('owner','admin')
    when p_from_status = 'in_review'          and p_to_status = 'draft'             then true  -- request_changes
    when p_from_status = 'approved'           and p_to_status = 'generating'        then true  -- start_generation
    when p_from_status = 'approved'           and p_to_status = 'draft'             then true  -- re-edit
    when p_from_status = 'generating'         and p_to_status = 'assembled'         then true
    when p_from_status = 'generating'         and p_to_status = 'generation_failed' then true
    when p_from_status = 'generation_failed'  and p_to_status = 'generating'        then true  -- retry
    when p_from_status = 'generation_failed'  and p_to_status = 'approved'          then true  -- give_up
    when p_from_status = 'assembled'          and p_to_status = 'generating'        then true  -- regenerate
    when p_from_status = 'assembled'          and p_to_status = 'exported'          then true
    when p_from_status = 'exported'           and p_to_status = 'archived'          then v_role in ('owner','admin')
    when p_from_status = 'assembled'          and p_to_status = 'archived'          then v_role in ('owner','admin')
    when p_from_status = 'approved'           and p_to_status = 'archived'          then v_role in ('owner','admin')
    when p_from_status = 'draft'              and p_to_status = 'archived'          then v_role in ('owner','admin')
    else false
  end;

  if not v_allowed then
    raise exception 'invalid_transition: % → %', p_from_status, p_to_status
      using errcode = '22023';
  end if;

  update video_projects
  set
    status  = p_to_status,
    version = version + 1
  where video_projects.id = p_project_id
    and status  = p_from_status
    and version = p_expected_version
  returning video_projects.id, video_projects.status, video_projects.version
  into id, new_status, new_version;

  if id is null then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  insert into video_project_status_audit (project_id, from_status, to_status, actor, reason)
  values (p_project_id, p_from_status, p_to_status, p_actor, p_reason);

  return next;
end;
$$;
