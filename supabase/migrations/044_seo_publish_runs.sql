-- SEO module Phase 0: publish workflow durability tables + atomic
-- status-transition RPC.
--
-- Why not Vercel Workflow DevKit? Per eng review §A4, we get 80% of
-- DevKit's value by checkpointing each step into seo_publish_run_steps
-- and resuming from the first non-completed step. Revisit after 100
-- publishes.
--
-- Publish step graph (each row is one seo_publish_run_steps entry):
--
--   load_post → upload_cover → upload_inline_assets → upsert_entry
--      → publish_entry → notify_gruve → write_post_index → embed → mark_published
--
-- Resume rule: find max(step where status='ok') for a given run_id,
-- restart at the next step. Each step is idempotent so re-running a
-- 'failed' attempt at the same attempt number is safe.

create table if not exists seo_publish_runs (
  id              uuid primary key default gen_random_uuid(),
  blog_post_id    uuid not null references blog_posts(id) on delete cascade,
  tenant_slug     text not null references tenants(slug) on delete cascade,
  workflow_run_id text,
  status          text not null check (status in ('running','succeeded','failed','cancelled')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  error           jsonb,
  triggered_by    uuid references auth.users(id) on delete set null
);

create index if not exists idx_seo_publish_runs_blog_post
  on seo_publish_runs(blog_post_id, started_at desc);
create index if not exists idx_seo_publish_runs_tenant_status
  on seo_publish_runs(tenant_slug, status, started_at desc);

create table if not exists seo_publish_run_steps (
  run_id      uuid not null references seo_publish_runs(id) on delete cascade,
  step        text not null,
  attempt     int  not null,
  status      text not null check (status in ('ok','failed','skipped')),
  duration_ms int,
  payload     jsonb,
  error       jsonb,
  recorded_at timestamptz not null default now(),
  primary key (run_id, step, attempt)
);

create index if not exists idx_seo_publish_run_steps_lookup
  on seo_publish_run_steps(run_id, recorded_at desc);

alter table seo_publish_runs       enable row level security;
alter table seo_publish_run_steps  enable row level security;

drop policy if exists "members read publish_runs" on seo_publish_runs;
create policy "members read publish_runs" on seo_publish_runs
  for select using (public.is_tenant_member(tenant_slug));

drop policy if exists "members read publish_run_steps" on seo_publish_run_steps;
create policy "members read publish_run_steps" on seo_publish_run_steps
  for select using (
    exists (
      select 1 from seo_publish_runs r
      where r.id = seo_publish_run_steps.run_id
        and public.is_tenant_member(r.tenant_slug)
    )
  );
-- Writes are service-role-only.

-- ─── Atomic state transitions ────────────────────────────────
-- Wraps the optimistic version check in one statement so concurrent
-- approvers can't both win. Caller passes expected_version; if it
-- doesn't match the row's current version, the function raises and
-- the second approver gets a clear conflict error.

create or replace function public.transition_blog_post_status(
  p_post_id           uuid,
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
  v_tenant text;
  v_role   text;
  v_allowed boolean;
begin
  -- Lock the row.
  select tenant_slug into v_tenant
  from blog_posts
  where blog_posts.id = p_post_id
  for update;

  if v_tenant is null then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  if not public.is_tenant_member(v_tenant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_role := public.tenant_role(v_tenant);

  -- Whitelist of legal transitions.
  v_allowed := case
    when p_from_status = 'draft'          and p_to_status = 'in_review'      then true
    when p_from_status = 'editing'        and p_to_status = 'in_review'      then true  -- legacy alias
    when p_from_status = 'review'         and p_to_status = 'in_review'      then true  -- legacy alias migration
    when p_from_status = 'in_review'      and p_to_status = 'seo_approved'   then v_role in ('owner','admin')
    when p_from_status = 'in_review'      and p_to_status = 'draft'          then true  -- request_changes
    when p_from_status = 'seo_approved'   and p_to_status = 'scheduled'      then true
    when p_from_status = 'seo_approved'   and p_to_status = 'publishing'     then true
    when p_from_status = 'scheduled'      and p_to_status = 'publishing'     then true
    when p_from_status = 'publishing'     and p_to_status = 'published'      then true
    when p_from_status = 'publishing'     and p_to_status = 'publish_failed' then true
    when p_from_status = 'publish_failed' and p_to_status = 'publishing'     then true  -- retry
    when p_from_status = 'publish_failed' and p_to_status = 'draft'          then true
    when p_from_status = 'published'      and p_to_status = 'archived'       then v_role in ('owner','admin')
    else false
  end;

  if not v_allowed then
    raise exception 'invalid_transition: % → %', p_from_status, p_to_status
      using errcode = '22023';
  end if;

  -- Optimistic check + update in one statement.
  update blog_posts
  set
    status  = p_to_status,
    version = version + 1
  where blog_posts.id = p_post_id
    and status  = p_from_status
    and version = p_expected_version
  returning blog_posts.id, blog_posts.status, blog_posts.version
  into id, new_status, new_version;

  if id is null then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  insert into seo_post_status_audit (post_id, from_status, to_status, actor, reason)
  values (p_post_id, p_from_status, p_to_status, p_actor, p_reason);

  return next;
end;
$$;

create table if not exists seo_post_status_audit (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references blog_posts(id) on delete cascade,
  from_status text not null,
  to_status   text not null,
  actor       uuid references auth.users(id) on delete set null,
  reason      text,
  decided_at  timestamptz not null default now()
);

create index if not exists idx_seo_post_status_audit_post
  on seo_post_status_audit(post_id, decided_at desc);

alter table seo_post_status_audit enable row level security;

drop policy if exists "members read status_audit" on seo_post_status_audit;
create policy "members read status_audit" on seo_post_status_audit
  for select using (
    exists (
      select 1 from blog_posts p
      where p.id = seo_post_status_audit.post_id
        and public.is_tenant_member(p.tenant_slug)
    )
  );
-- Writes happen inside transition_blog_post_status() (security definer).

alter table blog_posts
  drop constraint if exists blog_posts_publish_run_fk;
alter table blog_posts
  add constraint blog_posts_publish_run_fk
  foreign key (publish_run_id) references seo_publish_runs(id) on delete set null;
