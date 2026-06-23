-- 069_r2_storage.sql
-- Switch content pipeline storage from Google Drive to Cloudflare R2.
-- Supabase Storage (saved-assets, generated-videos) also moves to R2.
--
-- Strategy:
--   • Existing Drive-backed content_items keep their drive_file_id and
--     remain accessible via drive_web_view_link until a background
--     migration moves them to R2.
--   • New uploads set storage_provider = 'r2', storage_key, storage_url.
--   • Drive columns stay for backward compatibility; can be dropped after
--     full migration.
--   • content_upload_sessions gets r2_key for R2 upload tracking.

-- ── content_items: add R2 columns ───────────────────────────────────

-- Drop NOT NULL so Drive column is optional for new R2 uploads.
alter table content_items
  alter column drive_file_id drop not null;

alter table content_items
  add column if not exists storage_provider text not null default 'drive'
    check (storage_provider in ('drive', 'r2')),
  add column if not exists storage_key text,
  add column if not exists storage_url text;

-- Integrity: drive items must have drive_file_id; r2 items must have storage_key.
alter table content_items
  add constraint chk_drive_file_when_drive
    check (storage_provider != 'drive' or drive_file_id is not null),
  add constraint chk_storage_key_when_r2
    check (storage_provider != 'r2' or storage_key is not null);

-- ── content_upload_sessions: add R2 upload key ──────────────────────

-- Make drive_resumable_uri nullable (R2 uploads don't have a Drive URI).
alter table content_upload_sessions
  alter column drive_resumable_uri drop not null;

alter table content_upload_sessions
  add column if not exists storage_provider text not null default 'drive'
    check (storage_provider in ('drive', 'r2')),
  add column if not exists r2_key text;

-- Integrity: drive sessions must have uri; r2 sessions must have key.
alter table content_upload_sessions
  add constraint chk_drive_uri_when_drive
    check (storage_provider != 'drive' or drive_resumable_uri is not null),
  add constraint chk_r2_key_when_r2_session
    check (storage_provider != 'r2' or r2_key is not null);

-- Index for reconcile cron — only Drive files need Drive-status checks.
drop index if exists idx_content_items_drive_status;
create index idx_content_items_drive_status
  on content_items(tenant_slug, drive_status)
  where drive_status <> 'ok' and storage_provider = 'drive';
