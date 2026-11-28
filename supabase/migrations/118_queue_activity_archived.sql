-- 118: let the activity log record the stale-queue cleanup.
--
-- The queue-nudge cron archives queue items that are open and untouched for
-- 30 days (status 'archived', hidden, never deleted) and writes one
-- queue_activity_log row per item, with actor_id null (system). The action
-- check from 106/110 did not allow 'archived', so widen it.
--
-- Safe to re-run. Until this runs, the cron archives nothing (it writes the
-- audit row first and stops if that fails); the emails still go out.

do $$
begin
  if to_regclass('public.queue_activity_log') is not null then
    alter table queue_activity_log drop constraint if exists queue_activity_log_action_check;
    alter table queue_activity_log
      add constraint queue_activity_log_action_check
      check (action in ('opened','copied_reply','resolved','reopened','dismissed','snoozed','unassigned_on_departure','archived'));
  end if;
end $$;
