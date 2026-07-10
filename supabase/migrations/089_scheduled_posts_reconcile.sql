-- Reconciliation: production's `scheduled_posts` table is missing 10
-- columns that migration 067's `create table` defines. `create table
-- if not exists` no-ops when a table already exists — so at some
-- point a `scheduled_posts` table with an older/narrower shape was
-- created in this project, and 067 silently skipped creating the real
-- one. 068's `alter table ... add column source_api_post_id` still
-- worked fine (ALTER doesn't care what CREATE would have done), which
-- is why that one column made it through while the rest didn't.
--
-- Net effect: the Social Publishing Engine (Composer/Schedule, the
-- qstash-publish webhook, sync-post-metrics) has never been able to
-- persist post content, media, or a published post's platform id/url
-- in this environment — confirmed via a 0-row count on the table
-- (nothing has ever successfully round-tripped through it). This is
-- the exact "past mismatch caused silent empty-calendar bugs" failure
-- mode CLAUDE.md's Social Publishing Engine section warns about,
-- still live. Discovered while building /api/v1 Publishing routes
-- (PR2 of the token API), not caused by that work.
--
-- All columns/constraints below are copied verbatim from 067 — this
-- migration exists only to make the real table match the one that
-- should have been created, idempotently and safely against the
-- confirmed-empty table (`content` can be added NOT NULL with no
-- default because there are zero existing rows to violate it).

alter table scheduled_posts
  add column if not exists connection_id uuid references platform_connections(id) on delete set null,
  add column if not exists content text not null,
  add column if not exists media_paths text[] not null default '{}',
  add column if not exists posted_at timestamptz,
  add column if not exists platform_post_id text,
  add column if not exists platform_post_url text,
  add column if not exists error_message text,
  add column if not exists source text not null default 'composer',
  add column if not exists source_draft_id uuid references social_drafts(id) on delete set null,
  add column if not exists qstash_message_id text;

alter table scheduled_posts drop constraint if exists scheduled_posts_source_check;
alter table scheduled_posts add constraint scheduled_posts_source_check
  check (source in ('composer', 'engage', 'ai-content'));

create index if not exists idx_scheduled_posts_due
  on scheduled_posts(status, scheduled_for)
  where status = 'scheduled';

create index if not exists idx_scheduled_posts_tenant
  on scheduled_posts(tenant_slug, scheduled_for desc);
