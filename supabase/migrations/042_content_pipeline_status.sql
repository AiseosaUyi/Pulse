-- Slice — Content Pipeline status set update.
-- Renames "ready" → "not_posted" and makes that the default.
-- Final status set: not_posted | scheduled | posted | archived | draft.
--
-- "Not posted" is the day-zero state for a freshly uploaded asset
-- — it's queued for posting but not yet scheduled or published.
-- "Draft" is reserved for in-progress work that isn't ready for the
-- queue. The semantic difference: not_posted = ready, just hasn't
-- shipped yet; draft = still being worked on.

-- 1) Drop the old check constraint
alter table content_items
  drop constraint if exists content_items_status_check;

-- 2) Migrate existing "ready" rows to "not_posted"
update content_items set status = 'not_posted' where status = 'ready';

-- 3) Re-add the check with the new allowed values
alter table content_items
  add constraint content_items_status_check
  check (status in ('not_posted','scheduled','posted','archived','draft'));

-- 4) Switch default
alter table content_items
  alter column status set default 'not_posted';
