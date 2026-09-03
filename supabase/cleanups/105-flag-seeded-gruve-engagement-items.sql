-- Flags the seeded/manual gruve engagement_items rows found during the
-- Action Queue diagnosis (docs/ACTION-QUEUE-BRIEF.md §2.1): all 8 rows for
-- tenant_slug='gruve' have source='manual', same-batch timestamps
-- (2026-07-31), none from composio — test/demo data, not real activity.
-- "Seed data in a queue that humans are told to trust is worse than an
-- empty queue" — flagged (dismissed), not hard-deleted, so it stays
-- recoverable/inspectable but drops out of every board query
-- (listActionQueue only reads status IN ('open','snoozed')).
--
-- Review the SELECT below before running the UPDATE — if any of these 8
-- rows turn out to be real human-entered notes worth keeping, dismiss
-- fewer than all of them, or handle their `replied` state individually
-- first.

select id, type, from_handle, content, received_at, replied
from engagement_items
where tenant_slug = 'gruve' and platform = 'instagram' and source = 'manual';

update engagement_items
set status = 'dismissed', resolved_at = now()
where tenant_slug = 'gruve' and platform = 'instagram' and source = 'manual' and status != 'dismissed';
