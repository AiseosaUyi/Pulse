-- Video generation engine — data layer. Turns approved content into short-form
-- video via Seedance 2.0 (PicsArt). Mirrors the SEO engine's durable-run +
-- approval discipline. Additive only.
--
-- Durable generation step graph (one video_generation_run_steps row each):
--   load_project → upload_refs → [per clip: quote_clip → submit_clip →
--   poll_clip → store_output → extract_last_frame?] → assemble →
--   store_assembled → mark_assembled
-- Resume rule (same as SEO publish runner): restart at the first step not 'ok'.

-- ── Media-credit telemetry (additive column on the existing log) ───────────
alter table ai_call_log
  add column if not exists credits int;   -- provider credits for media rows

-- ── Storage bucket for reference uploads + generated clips ─────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'generated-videos',
  'generated-videos',
  true,
  209715200, -- 200 MB
  array[
    'video/mp4','video/quicktime','video/webm',
    'image/jpeg','image/png','image/webp',
    'audio/mpeg','audio/mp4','audio/wav'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read generated-videos" on storage.objects;
create policy "public read generated-videos"
  on storage.objects for select using (bucket_id = 'generated-videos');

-- ── Reusable identity registry (the moat) ─────────────────────────────────
create table if not exists video_characters (
  id                   uuid primary key default gen_random_uuid(),
  tenant_slug          text not null references tenants(slug) on delete cascade,
  name                 text not null,
  description          text,
  identity_prompt      text,                       -- appended to every clip prompt
  reference_asset_ids  uuid[] not null default '{}'::uuid[],  -- → video_assets, max 9
  default_aspect_ratio text not null default '9:16',
  status               text not null default 'active' check (status in ('active','archived')),
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_video_characters_tenant
  on video_characters(tenant_slug, status, created_at desc);

-- ── Uploaded + derived media ──────────────────────────────────────────────
create table if not exists video_assets (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null references tenants(slug) on delete cascade,
  kind         text not null check (kind in ('image','video','audio')),
  role         text not null check (role in (
                 'character_ref','source_video','ref_audio',
                 'start_frame','end_frame','clip_output','last_frame')),
  storage_url  text not null,                       -- Pulse-owned public URL
  picsart_uid  text,
  content_hash text,
  width        int,
  height       int,
  duration_s   numeric(6,2),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_video_assets_tenant
  on video_assets(tenant_slug, role, created_at desc);
create unique index if not exists uq_video_assets_tenant_hash
  on video_assets(tenant_slug, content_hash) where content_hash is not null;

-- ── The unit of approval ──────────────────────────────────────────────────
create table if not exists video_projects (
  id                       uuid primary key default gen_random_uuid(),
  tenant_slug              text not null references tenants(slug) on delete cascade,
  title                    text not null,
  source_kind              text not null default 'manual'
                           check (source_kind in ('content_plan','blog_post','brief','manual')),
  content_plan_id          uuid references content_plans(id) on delete set null,
  blog_post_id             uuid references blog_posts(id) on delete set null,
  brief_id                 uuid references content_briefs(id) on delete set null,
  status                   text not null default 'draft' check (status in (
                             'draft','in_review','approved','generating',
                             'assembled','exported','generation_failed','archived')),
  version                  int  not null default 1,
  aspect_ratio             text not null default '9:16',
  target_resolution        text not null default '720p',
  default_model            text not null default 'seedance-2.0',
  generate_audio           boolean not null default false,
  credit_estimate          int,
  credit_actual            int,
  assembled_output_asset_id uuid references video_assets(id) on delete set null,
  generation_run_id        uuid,                    -- → video_generation_runs (set during run)
  last_error               text,
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_video_projects_tenant
  on video_projects(tenant_slug, status, created_at desc);

-- ── Storyboard rows ───────────────────────────────────────────────────────
create table if not exists video_clips (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references video_projects(id) on delete cascade,
  seq                  int  not null,
  mode                 text not null default 'identity'
                       check (mode in ('identity','continuity','replicate')),
  model                text not null default 'seedance-2.0',
  prompt               text not null,
  negative_prompt      text,
  duration_s           int  not null default 10,
  resolution           text not null default '720p',
  aspect_ratio         text not null default '9:16',
  generate_audio       boolean not null default false,
  character_id         uuid references video_characters(id) on delete set null,
  source_video_asset_id uuid references video_assets(id) on delete set null,
  start_frame_asset_id uuid references video_assets(id) on delete set null,
  end_frame_asset_id   uuid references video_assets(id) on delete set null,
  ref_audio_asset_ids  uuid[] not null default '{}'::uuid[],
  credit_estimate      int,
  credit_actual        int,
  output_asset_id      uuid references video_assets(id) on delete set null,
  last_frame_asset_id  uuid references video_assets(id) on delete set null,
  status               text not null default 'planned'
                       check (status in ('planned','quoted','generating','ready','failed')),
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists uq_video_clips_project_seq
  on video_clips(project_id, seq);

-- ── Durable workflow (clone of seo_publish_runs / _steps) ──────────────────
create table if not exists video_generation_runs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references video_projects(id) on delete cascade,
  tenant_slug     text not null references tenants(slug) on delete cascade,
  workflow_run_id text,                              -- idempotency: "{project_id}:{version}"
  status          text not null check (status in ('running','succeeded','failed','cancelled')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  error           jsonb,
  triggered_by    uuid references auth.users(id) on delete set null
);
create index if not exists idx_video_generation_runs_project
  on video_generation_runs(project_id, started_at desc);
create index if not exists idx_video_generation_runs_tenant_status
  on video_generation_runs(tenant_slug, status, started_at desc);

create table if not exists video_generation_run_steps (
  run_id      uuid not null references video_generation_runs(id) on delete cascade,
  step        text not null,
  attempt     int  not null,
  status      text not null check (status in ('ok','failed','skipped')),
  duration_ms int,
  payload     jsonb,
  error       jsonb,
  recorded_at timestamptz not null default now(),
  primary key (run_id, step, attempt)
);
create index if not exists idx_video_generation_run_steps_lookup
  on video_generation_run_steps(run_id, recorded_at desc);

-- ── Provider job tracking (poll loop) ─────────────────────────────────────
create table if not exists video_render_jobs (
  id              uuid primary key default gen_random_uuid(),
  clip_id         uuid not null references video_clips(id) on delete cascade,
  tenant_slug     text not null references tenants(slug) on delete cascade,
  provider        text not null default 'picsart',
  provider_job_id text,
  status          text not null default 'submitted'
                  check (status in ('submitted','polling','succeeded','failed')),
  attempts        int  not null default 0,
  submitted_at    timestamptz not null default now(),
  last_polled_at  timestamptz,
  result_url      text,
  error           text
);
create index if not exists idx_video_render_jobs_clip
  on video_render_jobs(clip_id, submitted_at desc);
create index if not exists idx_video_render_jobs_open
  on video_render_jobs(status, last_polled_at) where status in ('submitted','polling');

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Member read/write on the editable entities; read-only on run/job logs
-- (service-role writes only).
-- These three are tenant-scoped (have a tenant_slug column).
do $$
declare t text;
begin
  foreach t in array array['video_characters','video_assets','video_projects']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "members access %1$s" on %1$I', t);
    execute format(
      'create policy "members access %1$s" on %1$I for all using (public.is_tenant_member(tenant_slug)) with check (public.is_tenant_member(tenant_slug))',
      t
    );
  end loop;
end $$;

-- video_clips is keyed by project, not tenant_slug — gate via the project.
alter table video_clips enable row level security;
drop policy if exists "members access video_clips" on video_clips;
create policy "members access video_clips" on video_clips
  for all using (
    exists (select 1 from video_projects p
            where p.id = video_clips.project_id
              and public.is_tenant_member(p.tenant_slug))
  )
  with check (
    exists (select 1 from video_projects p
            where p.id = video_clips.project_id
              and public.is_tenant_member(p.tenant_slug))
  );

alter table video_generation_runs enable row level security;
drop policy if exists "members read video_runs" on video_generation_runs;
create policy "members read video_runs" on video_generation_runs
  for select using (public.is_tenant_member(tenant_slug));

alter table video_generation_run_steps enable row level security;
drop policy if exists "members read video_run_steps" on video_generation_run_steps;
create policy "members read video_run_steps" on video_generation_run_steps
  for select using (
    exists (select 1 from video_generation_runs r
            where r.id = video_generation_run_steps.run_id
              and public.is_tenant_member(r.tenant_slug))
  );

alter table video_render_jobs enable row level security;
drop policy if exists "members read video_render_jobs" on video_render_jobs;
create policy "members read video_render_jobs" on video_render_jobs
  for select using (public.is_tenant_member(tenant_slug));

-- ── updated_at triggers ───────────────────────────────────────────────────
create or replace function video_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['video_characters','video_projects','video_clips']
  loop
    execute format('drop trigger if exists %1$s_set_updated_at on %1$I', t);
    execute format(
      'create trigger %1$s_set_updated_at before update on %1$I for each row execute function video_set_updated_at()',
      t
    );
  end loop;
end $$;
