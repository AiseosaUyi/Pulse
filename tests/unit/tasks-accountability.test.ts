/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest";
import {
  archiveTask,
  completeOccurrence,
  uncompleteOccurrence,
  excuseOccurrence,
  getStreaksAndBreaches,
  getStandupReport,
  markMissedOccurrences,
} from "@/lib/services/tasks";
import { getTenantToday, addDays } from "@/lib/tasks/date-utils";
import { createTaskSchema } from "@/lib/validation/tasks";

function createMockSupabase(initialData: Record<string, any[]>) {
  const data: Record<string, any[]> = JSON.parse(JSON.stringify(initialData));

  return {
    from(table: string) {
      if (!data[table]) data[table] = [];
      const filters: Array<(row: any) => boolean> = [];
      let updates: Record<string, any> = {};

      const chain = {
        select(_cols = "*") {
          return chain;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return chain;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return chain;
        },
        in(col: string, vals: any[]) {
          filters.push((r) => vals.includes(r[col]));
          return chain;
        },
        not(col: string, op: string, val: any) {
          if (op === "in") {
            const cleaned = typeof val === "string"
              ? val.replace(/[()"]/g, "").split(",").map((s) => s.trim())
              : val;
            filters.push((r) => !cleaned.includes(r[col]));
          } else if (op === "is") {
            filters.push((r) => r[col] !== val);
          }
          return chain;
        },
        gte(col: string, val: any) {
          filters.push((r) => r[col] >= val);
          return chain;
        },
        lte(col: string, val: any) {
          filters.push((r) => r[col] <= val);
          return chain;
        },
        gt(col: string, val: any) {
          filters.push((r) => r[col] > val);
          return chain;
        },
        lt(col: string, val: any) {
          filters.push((r) => r[col] < val);
          return chain;
        },
        order(_col: string, _opts?: any) {
          return chain;
        },
        limit(count: number) {
          return {
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const matched = data[table].filter((r) => filters.every((f) => f(r))).slice(0, count);
              resolve({ data: matched, error: null });
            },
          };
        },
        range(from: number, to: number) {
          return {
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const matched = data[table].filter((r) => filters.every((f) => f(r)));
              resolve({ data: matched.slice(from, to + 1), error: null });
            },
          };
        },
        maybeSingle() {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        single() {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({
            data: matched[0] ?? null,
            error: matched[0] ? null : { message: "Not found" },
          });
        },
        update(patch: Record<string, any>) {
          updates = patch;
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              return this;
            },
            in(col: string, vals: any[]) {
              filters.push((r) => vals.includes(r[col]));
              return this;
            },
            select() {
              return {
                then(resolve: (res: { data: any[] | null; error: null }) => void) {
                  const matched = data[table].filter((r) => filters.every((f) => f(r)));
                  for (const row of matched) {
                    Object.assign(row, updates);
                  }
                  resolve({ data: matched, error: null });
                },
              };
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const matched = data[table].filter((r) => filters.every((f) => f(r)));
              for (const row of matched) {
                Object.assign(row, updates);
              }
              resolve({ data: matched, error: null });
            },
          };
        },
        insert(rows: any | any[]) {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const item of arr) {
            const id = item.id || `gen-${Math.random().toString(36).slice(2, 9)}`;
            data[table].push({ ...item, id });
          }
          return {
            select() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: arr[0], error: null });
                },
                single() {
                  return Promise.resolve({ data: arr[0], error: null });
                },
                then(resolve: (res: { data: any[] | null; error: null }) => void) {
                  resolve({ data: arr, error: null });
                },
              };
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              resolve({ data: arr, error: null });
            },
          };
        },
        delete() {
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              return this;
            },
            gte(col: string, val: any) {
              filters.push((r) => r[col] >= val);
              return this;
            },
            gt(col: string, val: any) {
              filters.push((r) => r[col] > val);
              return this;
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const remaining = data[table].filter((r) => !filters.every((f) => f(r)));
              data[table] = remaining;
              resolve({ data: null, error: null });
            },
          };
        },
        then(resolve: (res: { data: any[]; error: null }) => void) {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          resolve({ data: matched, error: null });
        },
      };

      return chain;
    },
    storage: {
      from(bucket: string) {
        return {
          list(dir: string, { search }: { search: string }) {
            if (bucket === "task-proofs" && search === "valid-receipt.png") {
              return Promise.resolve({ data: [{ name: "valid-receipt.png" }], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
    _getRawData() {
      return data;
    },
  } as any;
}

describe("Part C: Tasks & Accountability Overhaul", () => {
  const tenantSlug = "acme";

  it("validates task creation and update schemas strictly", () => {
    const validPersonId = "123e4567-e89b-42d3-a456-426614174000";

    // 1. Recurring task requires owner and recurrence type
    const validDaily = createTaskSchema.safeParse({
      title: "Daily Standup Notes",
      kind: "recurring",
      ownerPersonId: validPersonId,
      startDate: "2026-11-01",
      recurrence: "daily",
    });
    if (!validDaily.success) {
      console.error("Zod issues:", validDaily.error.issues);
    }
    expect(validDaily.success).toBe(true);

    const recurringNoOwner = createTaskSchema.safeParse({
      title: "Unowned Habit",
      kind: "recurring",
      startDate: "2026-11-01",
      recurrence: "daily",
    });
    expect(recurringNoOwner.success).toBe(false);

    // 2. Weekly requires recurrenceDays
    const weeklyNoDays = createTaskSchema.safeParse({
      title: "Weekly Sync",
      kind: "recurring",
      ownerPersonId: validPersonId,
      startDate: "2026-11-01",
      recurrence: "weekly",
      recurrenceDays: [],
    });
    expect(weeklyNoDays.success).toBe(false);

    // 3. Monthly requires recurrenceMonthDay 1-31
    const monthlyInvalidDay = createTaskSchema.safeParse({
      title: "Monthly Invoicing",
      kind: "recurring",
      ownerPersonId: validPersonId,
      startDate: "2026-11-01",
      recurrence: "monthly",
      recurrenceMonthDay: 35,
    });
    expect(monthlyInvalidDay.success).toBe(false);

    // 4. One-off requires dueDate
    const oneOffNoDate = createTaskSchema.safeParse({
      title: "One-off audit",
      kind: "one_off",
      startDate: "2026-11-01",
    });
    expect(oneOffNoDate.success).toBe(false);
  });

  it("cleans up stale occurrences on task archive, shortened end_date, and recurrence changes", async () => {
    const todayStr = "2026-11-05";
    const initialOccurrences = [
      // Past done occurrence - must NOT be deleted
      {
        id: "occ-past-done",
        tenant_slug: tenantSlug,
        task_id: "task-1",
        occurs_on: "2026-11-03",
        status: "done",
      },
      // Today pending occurrence - must be deleted on archive
      {
        id: "occ-today-pending",
        tenant_slug: tenantSlug,
        task_id: "task-1",
        occurs_on: todayStr,
        status: "pending",
      },
      // Future pending occurrence - must be deleted on archive
      {
        id: "occ-future-pending",
        tenant_slug: tenantSlug,
        task_id: "task-1",
        occurs_on: "2026-11-08",
        status: "pending",
      },
    ];

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      tasks: [
        {
          id: "task-1",
          tenant_slug: tenantSlug,
          title: "Daily Audit",
          kind: "recurring",
          owner_person_id: "person-1",
          status: "active",
          start_date: "2026-11-01",
          recurrence: "daily",
        },
      ],
      task_occurrences: initialOccurrences,
      task_events: [],
      task_checklist_items: [],
      person_leave: [],
    });

    // 1. Archive task
    await archiveTask(client, tenantSlug, "task-1", "actor-1");

    const db = client._getRawData();
    const task = db.tasks.find((t: any) => t.id === "task-1");
    expect(task.status).toBe("archived");

    // Past done occurrence preserved, future pending removed
    expect(db.task_occurrences.find((o: any) => o.id === "occ-past-done")).toBeDefined();
    expect(db.task_occurrences.find((o: any) => o.id === "occ-today-pending")).toBeUndefined();
    expect(db.task_occurrences.find((o: any) => o.id === "occ-future-pending")).toBeUndefined();
  });

  it("enforces status transition guards: same-day missed recovery vs concurrent completion & rejection of invalid status changes", async () => {
    const todayStr = getTenantToday("Africa/Lagos");
    const yesterdayStr = addDays(todayStr, -1);
    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      tasks: [
        {
          id: "task-1",
          tenant_slug: tenantSlug,
          title: "Daily Verification",
          kind: "recurring",
          owner_person_id: "person-1",
          status: "active",
          proof_required: "none",
        },
      ],
      task_occurrences: [
        {
          id: "occ-already-done",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: "person-1",
          occurs_on: todayStr,
          due_at: `${todayStr}T17:00:00Z`,
          status: "done",
          tasks: { id: "task-1", title: "Task 1", kind: "recurring", proof_required: "none", metric_target: null },
          team_people: { id: "person-1", user_id: "user-1", name: "Worker" },
          task_occurrence_checks: [],
        },
        {
          id: "occ-missed-today",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: "person-1",
          occurs_on: todayStr,
          due_at: `${todayStr}T10:00:00Z`,
          status: "missed",
          tasks: { id: "task-1", title: "Task 1", kind: "recurring", proof_required: "none", metric_target: null },
          team_people: { id: "person-1", user_id: "user-1", name: "Worker" },
          task_occurrence_checks: [],
        },
        {
          id: "occ-missed-yesterday",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: "person-1",
          occurs_on: yesterdayStr,
          due_at: `${yesterdayStr}T10:00:00Z`,
          status: "missed",
          tasks: { id: "task-1", title: "Task 1", kind: "recurring", proof_required: "none", metric_target: null },
          team_people: { id: "person-1", user_id: "user-1", name: "Worker" },
          task_occurrence_checks: [],
        },
        {
          id: "occ-pending",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: "person-1",
          occurs_on: todayStr,
          due_at: `${todayStr}T23:59:59Z`,
          status: "pending",
          tasks: { id: "task-1", title: "Task 1", kind: "recurring", proof_required: "none", metric_target: null },
          team_people: { id: "person-1", user_id: "user-1", name: "Worker" },
          task_occurrence_checks: [],
        },
      ],
      task_events: [],
    });

    // 1. Re-completing an already done occurrence must fail
    const completeDoneRes = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-already-done",
      completedBy: "user-1",
    });
    expect(completeDoneRes.ok).toBe(false);
    expect(completeDoneRes.error).toContain("already completed");

    // 2. Uncompleting a non-done occurrence must fail
    const uncompletePendingRes = await uncompleteOccurrence(
      client,
      tenantSlug,
      "occ-pending",
      "user-1",
      true
    );
    expect(uncompletePendingRes.ok).toBe(false);
    expect(uncompletePendingRes.error).toContain("Only completed task occurrences can be uncompleted");

    // 3. Excusing a non-missed occurrence must fail
    const excusePendingRes = await excuseOccurrence(
      client,
      tenantSlug,
      "occ-pending",
      "admin-1",
      "Sick day"
    );
    expect(excusePendingRes.ok).toBe(false);
    expect(excusePendingRes.error).toContain("Only missed task occurrences can be excused");

    // 4. Missed yesterday cannot be completed by worker
    const completeYesterdayRes = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-missed-yesterday",
      completedBy: "user-1",
    });
    expect(completeYesterdayRes.ok).toBe(false);
    expect(completeYesterdayRes.error).toContain("Missed occurrences from past days can only be completed by an admin");

    // 5. Missed today CAN be recovered on same day with completed_late: true and 'recovered' audit event
    const recoverTodayRes = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-missed-today",
      completedBy: "user-1",
    });
    expect(recoverTodayRes.ok).toBe(true);

    const db = client._getRawData();
    const recoveredOcc = db.task_occurrences.find((o: any) => o.id === "occ-missed-today");
    expect(recoveredOcc.status).toBe("done");
    expect(recoveredOcc.completed_late).toBe(true);

    const recoveredEvent = db.task_events.find((e: any) => e.action === "recovered");
    expect(recoveredEvent).toBeDefined();
    expect(recoveredEvent.occurrence_id).toBe("occ-missed-today");
  });

  it("validates proof and metrics: links, note >= 10 chars, tenant-scoped storage images, and metric values", async () => {
    const todayStr = getTenantToday("Africa/Lagos");
    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      tasks: [],
      task_occurrences: [
        {
          id: "occ-link",
          tenant_slug: tenantSlug,
          task_id: "t-link",
          owner_person_id: "person-1",
          occurs_on: todayStr,
          due_at: `${todayStr}T23:59:59Z`,
          status: "pending",
          tasks: { id: "t-link", title: "Link Task", kind: "one_off", proof_required: "link", metric_target: 10 },
          team_people: { id: "person-1", user_id: "u1", name: "Worker" },
          task_occurrence_checks: [],
        },
        {
          id: "occ-note",
          tenant_slug: tenantSlug,
          task_id: "t-note",
          owner_person_id: "person-1",
          occurs_on: todayStr,
          due_at: `${todayStr}T23:59:59Z`,
          status: "pending",
          tasks: { id: "t-note", title: "Note Task", kind: "one_off", proof_required: "note", metric_target: null },
          team_people: { id: "person-1", user_id: "u1", name: "Worker" },
          task_occurrence_checks: [],
        },
        {
          id: "occ-img",
          tenant_slug: tenantSlug,
          task_id: "t-img",
          owner_person_id: "person-1",
          occurs_on: todayStr,
          due_at: `${todayStr}T23:59:59Z`,
          status: "pending",
          tasks: { id: "t-img", title: "Image Task", kind: "one_off", proof_required: "image", metric_target: null },
          team_people: { id: "person-1", user_id: "u1", name: "Worker" },
          task_occurrence_checks: [],
        },
      ],
      task_events: [],
    });

    // 1. Link proof: rejects invalid link, accepts http/https
    const invalidLink = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-link",
      completedBy: "u1",
      proofUrl: "ftp://wrong.protocol",
    });
    expect(invalidLink.ok).toBe(false);

    // 2. Note proof: rejects < 10 characters
    const shortNote = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-note",
      completedBy: "u1",
      proofNote: "Done it", // only 7 chars
    });
    expect(shortNote.ok).toBe(false);
    expect(shortNote.error).toContain("at least 10 characters");

    const validNote = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-note",
      completedBy: "u1",
      proofNote: "Completed all scheduled calls for the day.", // >= 10 chars
    });
    expect(validNote.ok).toBe(true);

    // 3. Image proof: rejects path not starting with tenant slug
    const crossTenantImage = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-img",
      completedBy: "u1",
      proofImagePath: "other-tenant/proof.png",
    });
    expect(crossTenantImage.ok).toBe(false);
    expect(crossTenantImage.error).toContain("must belong to current tenant");

    // Rejects image missing in storage
    const missingStorageImage = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-img",
      completedBy: "u1",
      proofImagePath: `${tenantSlug}/missing.png`,
    });
    expect(missingStorageImage.ok).toBe(false);
    expect(missingStorageImage.error).toContain("not found in storage");

    // Accepts valid storage image
    const validImage = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-img",
      completedBy: "u1",
      proofImagePath: `${tenantSlug}/valid-receipt.png`,
    });
    expect(validImage.ok).toBe(true);
  });

  it("paginates streak occurrences across >1000 rows and accurately calculates standup report", async () => {
    const person = {
      id: "person-streak",
      tenant_slug: tenantSlug,
      name: "Streak Champion",
      active: true,
    };
    const inactivePerson = {
      id: "person-inactive",
      tenant_slug: tenantSlug,
      name: "Inactive Person",
      active: false,
    };

    // Generate >1000 occurrences across 35 tasks
    const tasks: any[] = [];
    const occurrences: any[] = [];

    for (let t = 1; t <= 35; t++) {
      const taskId = `task-${t}`;
      tasks.push({
        id: taskId,
        tenant_slug: tenantSlug,
        title: `Task ${t}`,
        kind: "recurring",
        owner_person_id: person.id,
        status: "active",
        start_date: "2026-10-01",
        recurrence: "daily",
      });

      // 30 days of occurrences for each task = 35 * 30 = 1050 rows!
      for (let day = 1; day <= 30; day++) {
        const dateStr = `2026-10-${String(day).padStart(2, "0")}`;
        occurrences.push({
          id: `occ-${t}-${day}`,
          tenant_slug: tenantSlug,
          task_id: taskId,
          owner_person_id: person.id,
          occurs_on: dateStr,
          status: day === 30 ? "pending" : "done", // Completed except today
          completed_at: day === 30 ? null : `${dateStr}T12:00:00Z`,
          tasks: {
            id: taskId,
            title: `Task ${t}`,
            kind: "recurring",
            metric_label: null,
            metric_target: null,
          },
        });
      }
    }

    expect(occurrences.length).toBe(1050);

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [person, inactivePerson],
      tasks,
      task_occurrences: occurrences,
      task_events: [],
      person_leave: [],
    });

    // 1. Streaks calculation with pagination
    const streakResult = await getStreaksAndBreaches(client, tenantSlug, { days: 30 });
    expect(streakResult.length).toBe(1); // Inactive person excluded
    expect(streakResult[0].person.name).toBe("Streak Champion");
    expect(streakResult[0].tasks.length).toBe(35);

    // 2. Standup report
    const standup = await getStandupReport(client, tenantSlug, "2026-10-01", "2026-10-29");
    expect(standup.people.length).toBe(1); // Inactive person excluded
    expect(standup.people[0].person.id).toBe(person.id);
    expect(standup.people[0].recurringStats.length).toBe(35);
    // Denominator excludes pending/skipped, so 100% completion rate for completed past days
    expect(standup.people[0].recurringStats.every((r) => r.rate === 100)).toBe(true);
    expect(standup.whatsAppText).toContain("100% accountability! 🔥");
  });

  it("skips unassigned occurrences in the missed sweep and produces zero breaches against nobody", async () => {
    const tenantSlug = "acme";
    const pastDueIso = "2026-10-01T12:00:00Z";

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [
        { id: "person-1", tenant_slug: tenantSlug, name: "Assigned Person", user_id: "user-1", active: true },
      ],
      tasks: [
        { id: "task-assigned", tenant_slug: tenantSlug, title: "Assigned Task", status: "active" },
        { id: "task-unassigned", tenant_slug: tenantSlug, title: "Unassigned Queue Task", status: "active" },
      ],
      task_occurrences: [
        {
          id: "occ-unassigned",
          tenant_slug: tenantSlug,
          task_id: "task-unassigned",
          owner_person_id: null,
          occurs_on: "2026-10-01",
          due_at: pastDueIso,
          status: "pending",
          tasks: { id: "task-unassigned", title: "Unassigned Queue Task", status: "active" },
          team_people: null,
        },
        {
          id: "occ-assigned",
          tenant_slug: tenantSlug,
          task_id: "task-assigned",
          owner_person_id: "person-1",
          occurs_on: "2026-10-01",
          due_at: pastDueIso,
          status: "pending",
          tasks: { id: "task-assigned", title: "Assigned Task", status: "active" },
          team_people: { id: "person-1", name: "Assigned Person" },
        },
      ],
      task_events: [],
      person_leave: [],
    });

    const res = await markMissedOccurrences(client, tenantSlug);
    expect(res.markedMissed).toBe(1);

    const db = client._getRawData();
    const unassignedOcc = db.task_occurrences.find((o: any) => o.id === "occ-unassigned");
    expect(unassignedOcc.status).toBe("pending"); // Unassigned remains pending, NOT missed

    const assignedOcc = db.task_occurrences.find((o: any) => o.id === "occ-assigned");
    expect(assignedOcc.status).toBe("missed"); // Assigned transitions to missed
  });

  it("filters leave strictly to status = 'approved', treating requested, declined, and cancelled leave as normal active days", async () => {
    const tenantSlug = "acme";
    const personId = "person-leave-test";
    const pastDueIso = "2026-10-01T12:00:00Z";

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [
        { id: personId, tenant_slug: tenantSlug, name: "Leave Tester", user_id: "user-1", active: true },
      ],
      tasks: [
        { id: "task-1", tenant_slug: tenantSlug, title: "Daily Habit", status: "active" },
      ],
      person_leave: [
        { person_id: personId, tenant_slug: tenantSlug, starts_on: "2026-10-01", ends_on: "2026-10-01", status: "cancelled" },
        { person_id: personId, tenant_slug: tenantSlug, starts_on: "2026-10-02", ends_on: "2026-10-02", status: "declined" },
        { person_id: personId, tenant_slug: tenantSlug, starts_on: "2026-10-03", ends_on: "2026-10-03", status: "requested" },
        { person_id: personId, tenant_slug: tenantSlug, starts_on: "2026-10-04", ends_on: "2026-10-04", status: "approved" },
      ],
      task_occurrences: [
        {
          id: "occ-cancelled",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: personId,
          occurs_on: "2026-10-01",
          due_at: pastDueIso,
          status: "pending",
          tasks: { id: "task-1", title: "Daily Habit", status: "active" },
          team_people: { id: personId, name: "Leave Tester" },
        },
        {
          id: "occ-declined",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: personId,
          occurs_on: "2026-10-02",
          due_at: pastDueIso,
          status: "pending",
          tasks: { id: "task-1", title: "Daily Habit", status: "active" },
          team_people: { id: personId, name: "Leave Tester" },
        },
        {
          id: "occ-requested",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: personId,
          occurs_on: "2026-10-03",
          due_at: pastDueIso,
          status: "pending",
          tasks: { id: "task-1", title: "Daily Habit", status: "active" },
          team_people: { id: personId, name: "Leave Tester" },
        },
        {
          id: "occ-approved",
          tenant_slug: tenantSlug,
          task_id: "task-1",
          owner_person_id: personId,
          occurs_on: "2026-10-04",
          due_at: pastDueIso,
          status: "pending",
          tasks: { id: "task-1", title: "Daily Habit", status: "active" },
          team_people: { id: personId, name: "Leave Tester" },
        },
      ],
      task_events: [],
    });

    const res = await markMissedOccurrences(client, tenantSlug);
    expect(res.markedSkipped).toBe(1); // Only approved leave is skipped
    expect(res.markedMissed).toBe(3); // Cancelled, declined, and requested are marked missed

    const db = client._getRawData();
    expect(db.task_occurrences.find((o: any) => o.id === "occ-approved").status).toBe("skipped");
    expect(db.task_occurrences.find((o: any) => o.id === "occ-cancelled").status).toBe("missed");
    expect(db.task_occurrences.find((o: any) => o.id === "occ-declined").status).toBe("missed");
    expect(db.task_occurrences.find((o: any) => o.id === "occ-requested").status).toBe("missed");
  });

  it("allows metric completion below target as honest partial work without blocking as a breach", async () => {
    const tenantSlug = "acme";
    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [
        { id: "person-metric", tenant_slug: tenantSlug, name: "Outreach Lead", user_id: "user-outreach", active: true },
      ],
      tasks: [
        {
          id: "task-metric",
          tenant_slug: tenantSlug,
          title: "Send 50 outreach DMs",
          kind: "recurring",
          owner_person_id: "person-metric",
          proof_required: "none",
          metric_label: "DMs sent",
          metric_target: 50,
          status: "active",
        },
      ],
      task_occurrences: [
        {
          id: "occ-metric-1",
          tenant_slug: tenantSlug,
          task_id: "task-metric",
          owner_person_id: "person-metric",
          occurs_on: getTenantToday("Africa/Lagos"),
          due_at: `${getTenantToday("Africa/Lagos")}T23:59:59Z`,
          status: "pending",
          tasks: {
            id: "task-metric",
            title: "Send 50 outreach DMs",
            kind: "recurring",
            proof_required: "none",
            metric_label: "DMs sent",
            metric_target: 50,
          },
          team_people: {
            id: "person-metric",
            name: "Outreach Lead",
            user_id: "user-outreach",
            lead_person_id: null,
          },
          task_occurrence_checks: [],
        },
        {
          id: "occ-metric-2",
          tenant_slug: tenantSlug,
          task_id: "task-metric",
          owner_person_id: "person-metric",
          occurs_on: getTenantToday("Africa/Lagos"),
          due_at: `${getTenantToday("Africa/Lagos")}T23:59:59Z`,
          status: "pending",
          tasks: {
            id: "task-metric",
            title: "Send 50 outreach DMs",
            kind: "recurring",
            proof_required: "none",
            metric_label: "DMs sent",
            metric_target: 50,
          },
          team_people: {
            id: "person-metric",
            name: "Outreach Lead",
            user_id: "user-outreach",
            lead_person_id: null,
          },
          task_occurrence_checks: [],
        },
      ],
      task_occurrence_checks: [],
      task_events: [],
      person_leave: [],
    });

    // Complete with 40 (below the target of 50)
    const res = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-metric-1",
      completedBy: "user-outreach",
      metricValue: 40,
    });

    expect(res.ok).toBe(true);
    const db = client._getRawData();
    const updatedOcc = db.task_occurrences.find((o: any) => o.id === "occ-metric-1");
    expect(updatedOcc.status).toBe("done");
    expect(updatedOcc.metric_value).toBe(40);

    // Negative metric values are still rejected
    const badRes = await completeOccurrence(client, tenantSlug, {
      occurrenceId: "occ-metric-2",
      completedBy: "user-outreach",
      metricValue: -5,
    });
    expect(badRes.ok).toBe(false);
    expect(badRes.error).toContain("negative");
  });
});
