-- One-off backfill for the composio-sync-engagement received_at bug
-- (see docs/ACTION-QUEUE-BRIEF.md §2.2, fixed going forward in
-- src/app/api/cron/composio-sync-engagement/route.ts). Existing rows that
-- came from that cron before the fix have received_at defaulted to the
-- sync time instead of the platform timestamp — this fixes ordering and
-- unanswered-comment age for rows already in the table.
update engagement_items
set received_at = created_at
where source = 'composio'
  and received_at is distinct from created_at;
