# Production Migration Run Order: Migrations 110 – 113

This runbook guides operators through applying database migrations 110, 111, 112, and 113 for the Pulse People, My Day, and Tasks overhauls.

---

## 0. Pre-Flight Backup

Before executing any migrations, back up the affected database tables via `pg_dump` or Supabase Dashboard backup:
- `tenants`
- `memberships`
- `profiles`
- `tenant_team_members` (if present)
- `prospects`
- `action_items`
- `engagement_items`
- `outbound_dms`
- `inbound_messages`
- `tasks`
- `task_occurrences`
- `task_checklist_items`
- `task_comments`
- `person_leave`

---

## Step 1: Run Migration 110 (Pre-Deploy)

**File**: `supabase/migrations/110_one_assignee_model.sql`  
**Description**: Establishes unified assignee model on `team_people`, migrates legacy roster rows, syncs memberships via tiered deterministic matching, adds `owner_person_id` to assignable entities, and creates `unassign_departed_person()` RPC.

### Execution & Verification
1. Paste and run `110_one_assignee_model.sql` in the Supabase SQL Editor.
2. Verify **zero duplicate people** were created (this query **must return 0 rows**):
   ```sql
   select tenant_slug, lower(trim(name)), count(*)
   from team_people
   group by 1, 2
   having count(*) > 1;
   ```
3. Inspect ambiguous owner matches (should be 0 or reviewed):
   ```sql
   select * from public.ambiguous_owner_matches;
   ```
4. Review unmatched legacy owner strings:
   ```sql
   select * from public.unmatched_owner_strings;
   ```

---

## Step 2: Run Migration 111 (Pre-Deploy)

**File**: `supabase/migrations/111_my_day_structured_approvals.sql`  
**Description**: Adds structured approval fields to `prospects`, backfills `status_updated_at` from `coalesce(updated_at, created_at, now())`, adds trigger `prospects_set_status_updated_at`, and adds `waiting_on_person_id` to items.

### Execution & Verification
1. Paste and run `111_my_day_structured_approvals.sql` in the Supabase SQL Editor.
2. Verify that historical won/closed leads did NOT get set to the migration time (this query **must return 0 or close to 0** for recent leads only):
   ```sql
   select count(*)
   from prospects
   where status_updated_at > now() - interval '10 minutes';
   ```

---

## Step 3: Run Migration 112 (Pre-Deploy)

**File**: `supabase/migrations/112_tasks_security_and_constraints.sql`  
**Description**: Additive and backward-compatible constraints. Adds restrictive support-user exclusions on tasks business tables (keeping `team_people` accessible to support for assignee chips), tenant-scoped storage policies on `task-proofs`, `ON DELETE SET NULL` on author foreign keys, `person_leave` workflow columns, observable pre-cleanup audit logging, and `NOT VALID` then `VALIDATE` tasks check constraints.

### Execution & Verification
1. Paste and run `112_tasks_security_and_constraints.sql` in the Supabase SQL Editor.
2. Check the pre-cleanup audit log to review any existing dirty rows adjusted before constraint validation:
   ```sql
   select * from public.migration_112_precleanup_log order by logged_at desc;
   ```

---

## Step 4: Deploy Application Code

Deploy the updated Pulse application code (production build via Vercel or deployment pipeline).
- Verify the build finishes with exit code 0.
- Verify health checks pass.

---

## Step 5: Run Migration 113 (Post-Deploy)

**File**: `supabase/migrations/113_tasks_member_select_only.sql`  
**Description**: Drops permissive `members manage` policies and applies select-only `members read` policies on `team_people`, `tasks`, `task_checklist_items`, `task_occurrences`, `task_occurrence_checks`, `task_comments`, and `person_leave`. Direct client writes via authenticated/anon keys are blocked; all writes route through audited server actions using the service role client.

> [!IMPORTANT]
> **Run timing**: Execute this migration immediately after the application deployment in Step 4 is verified live.
> **Cron avoidance**: Do NOT run at the `:05` mark of the hour (e.g. 10:05, 11:05 UTC) when `tasks-daily` occurrence generation executes.

1. Paste and run `113_tasks_member_select_only.sql` in the Supabase SQL Editor.

---

## Step 6: Post-Deploy Smoke Testing

Perform the following smoke tests on production/staging:
1. **Roster Edit**: Navigate to `/settings/team`. Edit targets or role for a team member and click Save. Verify the save succeeds.
2. **My Day Scope**: Log in as a member (non-admin). Open `/today` (My Day). Confirm only leads owned by that member are displayed.
3. **Task Completion with Proof**: In `/tasks`, complete a task occurrence requiring proof (e.g. valid URL or note). Confirm it marks done and records completion.
4. **Direct Write Refusal**: Using the browser console or Postman with a user token / anon key, attempt an insert/update directly to `task_occurrences`:
   ```javascript
   await supabase.from("task_occurrences").update({ status: "done" }).eq("id", "...");
   ```
   Confirm the operation returns an RLS error (`new row violates row-level security policy`).
5. **Departed Member Unassignment**: In `/settings/team`, deactivate or remove a test member. Verify that their assigned leads and action items now display as `Unassigned` and recurring tasks are paused.

---

## Rollback Plans

### Rollback for Migration 113
If server actions encounter RLS write errors, restore permissive member write policies:
```sql
do $$
declare t text;
begin
  foreach t in array array['team_people', 'tasks', 'task_checklist_items', 'task_occurrences', 'task_occurrence_checks', 'task_comments', 'person_leave']
  loop
    execute format('drop policy if exists "members read %1$s" on %1$I', t);
    execute format('create policy "members manage %1$s" on %1$I for all using (public.is_tenant_member(tenant_slug)) with check (public.is_tenant_member(tenant_slug))', t);
  end loop;
end $$;
```

### Rollback for Migration 112
If database check constraints reject valid application payloads, drop the check constraints:
```sql
alter table tasks drop constraint if exists tasks_schedule_check;
alter table tasks drop constraint if exists tasks_dates_check;
alter table tasks drop constraint if exists tasks_weekly_days_check;
alter table tasks drop constraint if exists tasks_recurring_owner_check;
alter table person_leave drop constraint if exists person_leave_dates_check;
```

### Rollback for Migration 111
If `status_updated_at` causes unexpected issues:
```sql
drop trigger if exists prospects_set_status_updated_at on prospects;
drop function if exists public.handle_prospect_status_updated();
alter table prospects drop column if exists status_updated_at;
```

### Rollback for Migration 110
If the single assignee model needs rollback:
```sql
drop trigger if exists on_membership_created on memberships;
drop trigger if exists on_membership_deleted on memberships;
drop function if exists public.handle_membership_created();
drop function if exists public.handle_membership_deleted();
alter table prospects drop column if exists owner_person_id;
alter table action_items drop column if exists owner_person_id;
alter table engagement_items drop column if exists owner_person_id;
```
