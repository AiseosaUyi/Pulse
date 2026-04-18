-- Content vault download pipeline. Extends saved_content with the fields
-- we fill in once the server has actually fetched the video/image bytes
-- and uploaded them to Supabase Storage. A row can live in three states:
--   link_only          — we stored just the URL (unsupported platform or
--                         extraction failed, user still sees the link)
--   extracted          — stored_path points at a real file in storage
--   extraction_failed  — tried, server error, saved with the error note
-- A fourth value 'pending' is reserved for future async jobs.
--
-- Content-addressable dedup: (tenant_slug, content_hash) is unique when
-- both fields are set. Re-saving the same video returns the existing row
-- instead of duplicating the file in storage.

alter table saved_content
  add column if not exists stored_path text,
  add column if not exists stored_mime text,
  add column if not exists file_size_bytes bigint,
  add column if not exists duration_sec int,
  add column if not exists author_handle text,
  add column if not exists thumbnail_path text,
  add column if not exists content_hash text,
  add column if not exists extraction_status text
    not null default 'link_only',
  add column if not exists extraction_error text;

-- Drop the constraint first so re-runs don't fail with "already exists".
alter table saved_content drop constraint if exists saved_content_extraction_status_check;
alter table saved_content add constraint saved_content_extraction_status_check
  check (extraction_status in ('extracted', 'link_only', 'extraction_failed', 'pending'));

create unique index if not exists uq_saved_content_tenant_hash
  on saved_content(tenant_slug, content_hash)
  where content_hash is not null;

-- Storage bucket for extracted media. Public read so the <video> / <img>
-- src attributes just work without signed URLs. Server-side writes only
-- (via the service role client), so we don't need an insert policy for
-- end-users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'saved-assets',
  'saved-assets',
  true,
  52428800, -- 50 MB
  array[
    'video/mp4',
    'video/quicktime',
    'video/webm',
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

drop policy if exists "public read saved-assets" on storage.objects;
create policy "public read saved-assets"
  on storage.objects
  for select
  using (bucket_id = 'saved-assets');
