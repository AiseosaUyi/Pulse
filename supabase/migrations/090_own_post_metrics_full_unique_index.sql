-- Reconciliation: migration 068's `idx_own_post_metrics_scheduled_post_platform`
-- is a PARTIAL unique index (`where scheduled_post_id is not null`). Postgres
-- can't infer a partial index for `ON CONFLICT (scheduled_post_id, platform)`
-- unless the same WHERE clause is repeated in the ON CONFLICT clause itself —
-- which the Supabase JS client's `.upsert(data, {onConflict: "col1,col2"})`
-- has no way to express. Every upsert against this index fails with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- This is the exact same bug class migration 057 already fixed once, on
-- `engagement_items` (see that migration's comment) — the fix there was
-- identical: drop the partial predicate, make the index full. NULL
-- `scheduled_post_id` rows (manual/csv/screenshot entries) stay unaffected
-- since Postgres treats NULLs as distinct in a unique index, same reasoning
-- as 057 already documents.
--
-- Net effect: /api/cron/sync-post-metrics has likely been failing this
-- upsert silently on every run for any post with a non-null
-- scheduled_post_id, in production, since 068 shipped. Discovered while
-- building the /api/v1 Publishing group's POST /posts/:id/metrics route
-- (same upsert shape), not caused by that work.

drop index if exists idx_own_post_metrics_scheduled_post_platform;

create unique index if not exists idx_own_post_metrics_scheduled_post_platform
  on own_post_metrics(scheduled_post_id, platform);
