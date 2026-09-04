-- Flags the seeded/manual gruve engagement_items rows found during the
-- Action Queue diagnosis (docs/ACTION-QUEUE-BRIEF.md §2.1): all 8 rows for
-- tenant_slug='gruve' have source='manual', same-batch timestamps
-- (2026-07-31), none from composio — test/demo data, not real activity.
-- "Seed data in a queue that humans are told to trust is worse than an
-- empty queue" — flagged (dismissed), not hard-deleted, so it stays
-- recoverable/inspectable but drops out of every board query
-- (listActionQueue only reads status IN ('open','snoozed')).
--
-- First pass of this script (now fixed below) incorrectly scoped the
-- UPDATE to `platform = 'instagram'` even though the diagnosis found
-- manual rows across every platform — 3 (twitter, tiktok, linkedin) were
-- still open and showing in "Needs a reply" as if real, discovered when
-- verifying the board only ever displays MCP-pushed or cron-synced data,
-- never anything hardcoded/seeded. Platform restriction removed.
--
-- Review the SELECT below before running the UPDATE — if any of these
-- rows turn out to be real human-entered notes worth keeping, dismiss
-- fewer than all of them, or handle their `replied` state individually
-- first.

select id, platform, type, from_handle, content, received_at, replied
from engagement_items
where tenant_slug = 'gruve' and source = 'manual' and status != 'dismissed';

update engagement_items
set status = 'dismissed', resolved_at = now()
where tenant_slug = 'gruve' and source = 'manual' and status != 'dismissed';
