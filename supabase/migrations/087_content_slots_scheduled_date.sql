-- Content calendar: add a real calendar date to content_slots.
--
-- Migration 086 deliberately shipped WITHOUT a calendar date — `position`
-- was the only ordering key, on the theory that the founder works through
-- slots whenever free, not on fixed days. Real usage (2026-07-09) showed
-- the opposite need: the founder wants an actual month-view calendar with
-- slots placed on specific days. `scheduled_date` is that date. It stays
-- "provisional" the same way position was — an unposted slot whose date
-- has passed gets bumped forward to today (see content-calendar-lifecycle.ts)
-- rather than sitting stale on a past date. `position` is kept as a stable
-- secondary sort key for same-day ordering, not removed.

alter table content_slots add column if not exists scheduled_date date;

-- Backfill any pre-existing rows (none expected in normal operation —
-- migration 086 shipped same-day — but safe if some slot back this ever
-- landed with no date) by spreading them across upcoming days from today,
-- ordered by position.
with ordered as (
  select id, row_number() over (partition by tenant_slug order by position) - 1 as offset
  from content_slots
  where scheduled_date is null
)
update content_slots
set scheduled_date = current_date + ordered.offset
from ordered
where content_slots.id = ordered.id;

alter table content_slots alter column scheduled_date set not null;
alter table content_slots alter column scheduled_date set default current_date;

create index if not exists idx_content_slots_tenant_scheduled_date
  on content_slots(tenant_slug, scheduled_date);
