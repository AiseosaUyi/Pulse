-- 069: social_drafts variant storage + platform hints
-- Stores per-platform variants so drafts can be fully restored in the Composer.
-- Adds primary_platform so the drafts list shows what platform was targeted.
-- Adds angle to show a human-readable preview label in the drafts list.

alter table social_drafts add column if not exists primary_platform text;
alter table social_drafts add column if not exists angle text;
alter table social_drafts add column if not exists x_text text;
alter table social_drafts add column if not exists linkedin_text text;
alter table social_drafts add column if not exists instagram_text text;
alter table social_drafts add column if not exists tiktok_text text;
alter table social_drafts add column if not exists youtube_text text;
alter table social_drafts add column if not exists hooks_json jsonb;
