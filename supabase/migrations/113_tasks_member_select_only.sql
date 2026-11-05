-- Migration 113: Tasks & People Member Select-Only RLS Policies
--
-- IMPORTANT DEPLOYMENT NOTE:
-- This migration MUST run ONLY AFTER the new application code has been deployed to production.
-- The previous application deployment still writes directly through the user-scoped Supabase client
-- (createClient). Running this migration before the new code is live will cause team roster edits,
-- target updates, and task completions to fail with RLS errors.
--
-- RUN TIMING:
-- Run this migration in the Supabase SQL Editor right after the new code deployment is verified live.
-- Avoid the :05 mark of the hour (e.g. 09:05, 10:05 UTC) when the tasks-daily cron job runs.
--
-- IDEMPOTENCY:
-- Fully idempotent; drops any existing "members manage" and "members read" policies before creating.

do $$
declare t text;
begin
  -- Select-only policies for members: drops "members manage" to prevent direct client mutations
  -- and ensures all mutations are routed through audited server actions using the service role client.
  foreach t in array array[
    'team_people',
    'tasks',
    'task_checklist_items',
    'task_occurrences',
    'task_occurrence_checks',
    'task_comments',
    'person_leave'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "members manage %1$s" on %1$I', t);
      execute format('drop policy if exists "members read %1$s" on %1$I', t);
      execute format(
        'create policy "members read %1$s" on %1$I for select using (public.is_tenant_member(tenant_slug))',
        t
      );
    end if;
  end loop;
end $$;
