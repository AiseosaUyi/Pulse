-- Slice — Content Pipeline. Centralized media + content operations:
-- upload, organize, track publishing status, assign ownership, schedule.
-- Replaces the team's current Drive-renaming workflow.
--
-- Storage model (hybrid):
--   - Drive holds the actual media files (per-tenant OAuth via
--     tenant_drive_connections).
--   - Supabase Storage caches thumbnails (saved-assets bucket, prefix
--     "pipeline-thumbs/<tenant>/").
--
-- This is asset-shaped, not post-shaped. scheduled_posts is brief→post
-- oriented; content_items represents the asset. v1.1 may bridge by
-- adding scheduled_posts.content_item_id and fanning out per-platform
-- when an item flips to status='scheduled'.
--
-- RLS — owner/admin manage Drive connection; tenant members read+write
-- their own content_items. Same pattern as tenant_integrations (028)
-- and connected_accounts (038).

-- ── tenant_drive_connections ─────────────────────────────────
-- Per-tenant Google Drive OAuth. One connection per tenant for MVP.
-- access_token is short-lived; refresh_token is long-lived (encrypted
-- at rest via pgcrypto if SUPABASE_VAULT_KEY is configured).
create table if not exists tenant_drive_connections (
  tenant_slug text primary key references tenants(slug) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text not null,
  -- Root /Pulse folder ID created on connect. Section folders nest
  -- under this and are stored in content_sections.drive_folder_id.
  root_folder_id text,
  connected_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','revoked','error')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tenant_drive_connections enable row level security;

drop policy if exists "owners manage tenant_drive_connections"
  on tenant_drive_connections;
create policy "owners manage tenant_drive_connections"
  on tenant_drive_connections
  for all
  using (public.tenant_role(tenant_slug) in ('owner','admin'))
  with check (public.tenant_role(tenant_slug) in ('owner','admin'));

create or replace function public.touch_tenant_drive_connections_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists tenant_drive_connections_set_updated_at
  on tenant_drive_connections;
create trigger tenant_drive_connections_set_updated_at
  before update on tenant_drive_connections
  for each row execute function public.touch_tenant_drive_connections_updated_at();

-- ── content_sections ─────────────────────────────────────────
-- Tabs inside Pipeline (Social Content / Video Extracts). Tenant
-- extensible. Defaults seeded on first Drive connect alongside the
-- Drive folder bootstrap.
create table if not exists content_sections (
  tenant_slug text not null references tenants(slug) on delete cascade,
  slug text not null,
  label text not null,
  drive_folder_id text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (tenant_slug, slug)
);

alter table content_sections enable row level security;

drop policy if exists "members read content_sections" on content_sections;
create policy "members read content_sections" on content_sections
  for select using (public.is_tenant_member(tenant_slug));

drop policy if exists "owners write content_sections" on content_sections;
create policy "owners write content_sections" on content_sections
  for all using (public.tenant_role(tenant_slug) in ('owner','admin'))
  with check (public.tenant_role(tenant_slug) in ('owner','admin'));

-- ── content_types ────────────────────────────────────────────
-- Default types seeded per-tenant on first visit (meme, ugc, promo,
-- testimonial, product, event, educational). Custom types created
-- inline from the upload modal. Slugify-only dedup (no fuzzy match).
create table if not exists content_types (
  tenant_slug text not null references tenants(slug) on delete cascade,
  slug text not null,
  label text not null,
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_slug, slug)
);

alter table content_types enable row level security;

drop policy if exists "members read content_types" on content_types;
create policy "members read content_types" on content_types
  for select using (public.is_tenant_member(tenant_slug));

drop policy if exists "members create content_types" on content_types;
create policy "members create content_types" on content_types
  for insert with check (public.is_tenant_member(tenant_slug));

drop policy if exists "owners delete content_types" on content_types;
create policy "owners delete content_types" on content_types
  for delete using (public.tenant_role(tenant_slug) in ('owner','admin'));

-- ── content_items ────────────────────────────────────────────
-- The main entity. Asset-shaped. Multi-platform via platforms[]
-- (single asset can target IG + TikTok + LinkedIn).
create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  section_slug text not null,
  title text not null,
  content_type_slug text,
  status text not null default 'draft'
    check (status in ('draft','ready','scheduled','posted','archived')),
  -- Platforms this asset targets. Allowed values mirror Pulse's
  -- canonical set: instagram, tiktok, linkedin, x, facebook, whatsapp,
  -- email. Validated at the action layer (zod) — we don't put a CHECK
  -- here because the canonical list may grow.
  platforms text[] not null default '{}',
  scheduled_at timestamptz,
  posted_at timestamptz,
  posted_url text,
  assigned_to uuid references auth.users(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,
  -- Drive references. drive_file_id is required at insert time; the
  -- upload session must complete before the row is written.
  drive_file_id text not null,
  drive_mime_type text,
  drive_size_bytes bigint,
  drive_web_view_link text,
  -- Drift state populated by the reconciliation cron + on-view
  -- batch validation.
  drive_status text not null default 'ok'
    check (drive_status in ('ok','missing','permission_lost')),
  -- Cached thumbnail in Supabase Storage. Path under saved-assets
  -- bucket; full URL constructed at read time via publicUrlFor().
  thumbnail_storage_key text,
  thumbnail_cached_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_slug, section_slug)
    references content_sections(tenant_slug, slug),
  foreign key (tenant_slug, content_type_slug)
    references content_types(tenant_slug, slug)
);

create index if not exists idx_content_items_list
  on content_items(tenant_slug, section_slug, status, created_at desc);
create index if not exists idx_content_items_scheduled
  on content_items(tenant_slug, scheduled_at)
  where scheduled_at is not null;
create index if not exists idx_content_items_assignee
  on content_items(tenant_slug, assigned_to)
  where assigned_to is not null;
create index if not exists idx_content_items_drive_file
  on content_items(drive_file_id);
create index if not exists idx_content_items_drive_status
  on content_items(tenant_slug, drive_status)
  where drive_status <> 'ok';

alter table content_items enable row level security;

drop policy if exists "members manage content_items" on content_items;
create policy "members manage content_items" on content_items
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_content_items_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists content_items_set_updated_at on content_items;
create trigger content_items_set_updated_at
  before update on content_items
  for each row execute function public.touch_content_items_updated_at();

-- ── content_upload_sessions ──────────────────────────────────
-- Resumable upload session recovery. Browser persists session URI in
-- localStorage; this row lets the server prove a session belongs to
-- the user + offers cleanup of abandoned sessions via a scheduled job.
create table if not exists content_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  drive_resumable_uri text not null,
  filename text not null,
  size_bytes bigint not null,
  section_slug text not null,
  status text not null default 'pending'
    check (status in ('pending','complete','abandoned')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index if not exists idx_upload_sessions_user_pending
  on content_upload_sessions(user_id, created_at desc)
  where status = 'pending';

alter table content_upload_sessions enable row level security;

drop policy if exists "users manage own upload_sessions" on content_upload_sessions;
create policy "users manage own upload_sessions" on content_upload_sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── drive_import_jobs ────────────────────────────────────────
-- Paste-link imports. Reference-in-place by default; copy-to-Pulse
-- mode deferred to v1.1 (per the engineering plan TODOs).
create table if not exists drive_import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  source_url text not null,
  kind text not null check (kind in ('file','folder')),
  status text not null default 'pending'
    check (status in ('pending','running','complete','failed')),
  imported_count int not null default 0,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_drive_import_jobs_tenant
  on drive_import_jobs(tenant_slug, created_at desc);

alter table drive_import_jobs enable row level security;

drop policy if exists "members manage drive_import_jobs" on drive_import_jobs;
create policy "members manage drive_import_jobs" on drive_import_jobs
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
