-- 068: Post engagement metrics sync
-- Adds source_api_post_id to scheduled_posts so we can look up SocialAPI.ai
-- metrics later. Extends own_post_metrics to support 'api' as a source and
-- adds a FK back to the scheduled post for upsert deduplication.

-- Store the SocialAPI.ai post ID (distinct from the platform-native post ID)
alter table scheduled_posts add column if not exists source_api_post_id text;

-- Allow cron-synced metrics alongside manual entry
alter table own_post_metrics drop constraint if exists own_post_metrics_source_check;
alter table own_post_metrics add constraint own_post_metrics_source_check
  check (source in ('csv', 'screenshot', 'manual', 'api'));

-- FK back to the originating scheduled post (enables upsert dedup)
alter table own_post_metrics add column if not exists scheduled_post_id uuid
  references scheduled_posts(id) on delete set null;

-- One metric row per (scheduled_post, platform) — cron upserts on this
create unique index if not exists idx_own_post_metrics_scheduled_post_platform
  on own_post_metrics(scheduled_post_id, platform)
  where scheduled_post_id is not null;
