import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateTaskInput,
  OccurrenceStatus,
  PersonLeave,
  PersonStreakGroup,
  ProofRequired,
  StandupPersonStats,
  StandupReport,
  StreakSquare,
  Task,
  TaskComment,
  TaskEvent,
  TaskOccurrence,
  TaskOccurrenceCheck,
  TaskStreakRow,
  TeamPerson,
  UpdateTaskInput,
} from "@/lib/types/tasks";
import {
  addDays,
  calculateStreak,
  getDatesInRange,
  getIsoDueAt,
  getTenantToday,
  isTaskScheduledForDate,
} from "@/lib/tasks/date-utils";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: Timezone, Tenant & People
// ─────────────────────────────────────────────────────────────────────────────

export async function getTenantTimezone(
  client: SupabaseClient,
  tenantSlug: string
): Promise<string> {
  const { data } = await client
    .from("tenants")
    .select("timezone")
    .eq("slug", tenantSlug)
    .single();

  return (data?.timezone as string) || "Africa/Lagos";
}

export async function getTenantPeople(
  client: SupabaseClient,
  tenantSlug: string,
  options?: { activeOnly?: boolean }
): Promise<TeamPerson[]> {
  let query = client
    .from("team_people")
    .select("id, tenant_slug, name, user_id, lead_person_id, active, created_at")
    .eq("tenant_slug", tenantSlug)
    .order("name", { ascending: true });

  if (options?.activeOnly !== false) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const people: TeamPerson[] = data.map((r) => ({
    id: r.id as string,
    tenantSlug: r.tenant_slug as string,
    name: r.name as string,
    userId: (r.user_id as string) ?? null,
    leadPersonId: (r.lead_person_id as string) ?? null,
    active: r.active as boolean,
    createdAt: r.created_at as string,
  }));

  const byId = new Map(people.map((p) => [p.id, p]));
  for (const p of people) {
    if (p.leadPersonId && byId.has(p.leadPersonId)) {
      p.leadPerson = byId.get(p.leadPersonId);
    }
  }

  return people;
}

export async function createTeamPerson(
  client: SupabaseClient,
  tenantSlug: string,
  params: { name: string; userId?: string | null; leadPersonId?: string | null }
): Promise<TeamPerson> {
  const { data, error } = await client
    .from("team_people")
    .insert({
      tenant_slug: tenantSlug,
      name: params.name.trim(),
      user_id: params.userId ?? null,
      lead_person_id: params.leadPersonId ?? null,
      active: true,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create team person: ${error?.message}`);
  }

  return {
    id: data.id as string,
    tenantSlug: data.tenant_slug as string,
    name: data.name as string,
    userId: (data.user_id as string) ?? null,
    leadPersonId: (data.lead_person_id as string) ?? null,
    active: data.active as boolean,
    createdAt: data.created_at as string,
  };
}

export async function updateTeamPerson(
  client: SupabaseClient,
  tenantSlug: string,
  id: string,
  patch: Partial<{ name: string; userId: string | null; leadPersonId: string | null; active: boolean }>
): Promise<TeamPerson> {
  const updateData: Record<string, unknown> = {};
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.userId !== undefined) updateData.user_id = patch.userId;
  if (patch.leadPersonId !== undefined) updateData.lead_person_id = patch.leadPersonId;
  if (patch.active !== undefined) updateData.active = patch.active;

  const { data, error } = await client
    .from("team_people")
    .update(updateData)
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update team person: ${error?.message}`);
  }

  return {
    id: data.id as string,
    tenantSlug: data.tenant_slug as string,
    name: data.name as string,
    userId: (data.user_id as string) ?? null,
    leadPersonId: (data.lead_person_id as string) ?? null,
    active: data.active as boolean,
    createdAt: data.created_at as string,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log: task_events
// ─────────────────────────────────────────────────────────────────────────────

export async function logTaskEvent(
  client: SupabaseClient,
  tenantSlug: string,
  params: {
    taskId?: string | null;
    occurrenceId?: string | null;
    actor?: string | null;
    action: string;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await client.from("task_events").insert({
      tenant_slug: tenantSlug,
      task_id: params.taskId ?? null,
      occurrence_id: params.occurrenceId ?? null,
      actor: params.actor ?? null,
      action: params.action,
      payload: params.payload ?? {},
    });
  } catch (err) {
    console.error("Failed to write task event:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord Webhook Notification
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyDiscordTask(
  client: SupabaseClient,
  tenantSlug: string,
  content: string
): Promise<void> {
  try {
    const { data: tenant } = await client
      .from("tenants")
      .select("settings")
      .eq("slug", tenantSlug)
      .single();

    const webhookUrl =
      (tenant?.settings?.discordTaskWebhook as string) ||
      (tenant?.settings?.discordWebhook as string);

    if (!webhookUrl || !webhookUrl.startsWith("http")) return;

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    console.error("Failed to post Discord task webhook:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Occurrence Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates occurrences for a task from max(startDate, today) up to today + 7 days.
 * Idempotent: uses ON CONFLICT DO NOTHING.
 * Copies checklist items from template to task_occurrence_checks.
 */
export async function generateOccurrencesForTask(
  client: SupabaseClient,
  task: Task,
  timezone: string,
  daysAhead = 7
): Promise<number> {
  if (task.status === "archived") return 0;

  const todayStr = getTenantToday(timezone);
  const startFrom = task.startDate > todayStr ? task.startDate : todayStr;
  const endAt = addDays(todayStr, daysAhead);

  // If task has end_date earlier than startFrom, nothing to generate
  if (task.endDate && task.endDate < startFrom) return 0;

  const rangeEnd = task.endDate && task.endDate < endAt ? task.endDate : endAt;
  const dates = getDatesInRange(startFrom, rangeEnd);

  // Fetch leave for the owner in this range
  const { data: leaveRows } = await client
    .from("person_leave")
    .select("starts_on, ends_on")
    .eq("tenant_slug", task.tenantSlug)
    .eq("person_id", task.ownerPersonId)
    .lte("starts_on", rangeEnd)
    .gte("ends_on", startFrom);

  const isLeaveDate = (dateStr: string) =>
    (leaveRows ?? []).some((l) => l.starts_on <= dateStr && l.ends_on >= dateStr);

  const isPausedDate = (dateStr: string) => {
    if (task.status !== "paused") return false;
    if (!task.pausedUntil) return true; // paused indefinitely
    return dateStr <= task.pausedUntil;
  };

  // Fetch checklist template items
  const { data: templateChecks } = await client
    .from("task_checklist_items")
    .select("position, label")
    .eq("task_id", task.id)
    .order("position", { ascending: true });

  let createdCount = 0;

  for (const dateStr of dates) {
    if (!isTaskScheduledForDate(task, dateStr)) continue;

    const dueAt = getIsoDueAt(dateStr, task.dueTime, timezone);
    const isPaused = isPausedDate(dateStr);
    const isLeave = isLeaveDate(dateStr);
    const status: OccurrenceStatus = isPaused || isLeave ? "skipped" : "pending";

    // Insert occurrence
    const { data: occData, error: occErr } = await client
      .from("task_occurrences")
      .insert({
        tenant_slug: task.tenantSlug,
        task_id: task.id,
        owner_person_id: task.ownerPersonId,
        occurs_on: dateStr,
        due_at: dueAt,
        status,
      })
      .select("id")
      .single();

    if (occErr) {
      // 23505 is unique violation (already exists), ignore idempotently
      continue;
    }

    createdCount++;

    // Copy checklist items to task_occurrence_checks
    if (occData && templateChecks && templateChecks.length > 0) {
      const checksToInsert = templateChecks.map((t) => ({
        tenant_slug: task.tenantSlug,
        occurrence_id: occData.id,
        position: t.position as number,
        label: t.label as string,
        checked: false,
      }));

      await client.from("task_occurrence_checks").insert(checksToInsert);
    }
  }

  return createdCount;
}

/**
 * Generate missing occurrences for all active/paused tasks in a tenant.
 */
export async function generateMissingOccurrences(
  client: SupabaseClient,
  tenantSlug: string,
  daysAhead = 7
): Promise<number> {
  const timezone = await getTenantTimezone(client, tenantSlug);
  const tasks = await listTasks(client, tenantSlug, { status: "active" });

  let total = 0;
  for (const task of tasks) {
    const count = await generateOccurrencesForTask(client, task, timezone, daysAhead);
    total += count;
  }
  return total;
}

/**
 * Daily job: Marks past due pending occurrences as missed (or skipped if on leave or paused).
 * Idempotent. Backfills any gap days.
 */
export async function markMissedOccurrences(
  client: SupabaseClient,
  tenantSlug: string
): Promise<{ markedMissed: number; markedSkipped: number }> {
  const nowIso = new Date().toISOString();

  // Find all pending occurrences where due_at < nowIso
  const { data: pendingRows, error } = await client
    .from("task_occurrences")
    .select(`
      id,
      task_id,
      owner_person_id,
      occurs_on,
      due_at,
      tasks (
        id,
        title,
        status,
        paused_until
      ),
      team_people (
        id,
        name
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .eq("status", "pending")
    .lt("due_at", nowIso);

  if (error || !pendingRows || pendingRows.length === 0) {
    return { markedMissed: 0, markedSkipped: 0 };
  }

  // Pre-fetch leave for owners
  const ownerIds = [...new Set(pendingRows.map((r) => r.owner_person_id as string))];
  const { data: leaves } = await client
    .from("person_leave")
    .select("person_id, starts_on, ends_on")
    .eq("tenant_slug", tenantSlug)
    .in("person_id", ownerIds);

  let markedMissed = 0;
  let markedSkipped = 0;

  for (const row of pendingRows) {
    const occursOn = row.occurs_on as string;
    const ownerId = row.owner_person_id as string;
    const taskData = row.tasks as unknown as { title: string; status: string; paused_until: string | null };
    const personData = row.team_people as unknown as { name: string };

    const isOnLeave = (leaves ?? []).some(
      (l) => l.person_id === ownerId && l.starts_on <= occursOn && l.ends_on >= occursOn
    );

    const isTaskPaused =
      taskData?.status === "paused" &&
      (!taskData.paused_until || occursOn <= taskData.paused_until);

    if (isOnLeave || isTaskPaused) {
      // Mark as skipped
      await client
        .from("task_occurrences")
        .update({ status: "skipped" })
        .eq("id", row.id);

      await logTaskEvent(client, tenantSlug, {
        taskId: row.task_id as string,
        occurrenceId: row.id as string,
        action: "skipped",
        payload: { reason: isOnLeave ? "person_leave" : "task_paused" },
      });
      markedSkipped++;
    } else {
      // Mark as missed (BREACH)
      await client
        .from("task_occurrences")
        .update({ status: "missed" })
        .eq("id", row.id);

      await logTaskEvent(client, tenantSlug, {
        taskId: row.task_id as string,
        occurrenceId: row.id as string,
        action: "missed",
        payload: { occursOn },
      });
      markedMissed++;

      // Trigger Discord breach notification
      const taskTitle = taskData?.title ?? "Task";
      const ownerName = personData?.name ?? "Team member";
      const [y, m, d] = occursOn.split("-").map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      const formattedDate = dateObj.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });

      await notifyDiscordTask(
        client,
        tenantSlug,
        `❌ Missed. ${ownerName}, *${taskTitle}*, ${formattedDate}`
      );
    }
  }

  return { markedMissed, markedSkipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Creation, Update & Listing
// ─────────────────────────────────────────────────────────────────────────────

export async function listTasks(
  client: SupabaseClient,
  tenantSlug: string,
  filters?: {
    personId?: string;
    status?: "active" | "paused" | "archived";
    kind?: "one_off" | "recurring";
    tag?: string;
  }
): Promise<Task[]> {
  let query = client
    .from("tasks")
    .select(`
      id,
      tenant_slug,
      title,
      description,
      owner_person_id,
      created_by,
      priority,
      kind,
      start_date,
      end_date,
      due_date,
      due_time,
      recurrence,
      recurrence_days,
      recurrence_month_day,
      proof_required,
      proof_hint,
      metric_label,
      metric_target,
      linked_type,
      linked_id,
      status,
      paused_until,
      tags,
      created_at,
      updated_at,
      team_people (
        id,
        tenant_slug,
        name,
        user_id,
        lead_person_id,
        active,
        created_at
      ),
      task_checklist_items (
        id,
        tenant_slug,
        task_id,
        position,
        label
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  else query = query.neq("status", "archived");

  if (filters?.personId) query = query.eq("owner_person_id", filters.personId);
  if (filters?.kind) query = query.eq("kind", filters.kind);
  if (filters?.tag) query = query.contains("tags", [filters.tag]);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((r) => {
    const ownerRaw = r.team_people as unknown as Record<string, unknown> | null;
    const checksRaw = (r.task_checklist_items as unknown as Array<Record<string, unknown>>) ?? [];

    const task: Task = {
      id: r.id as string,
      tenantSlug: r.tenant_slug as string,
      title: r.title as string,
      description: (r.description as string) ?? null,
      ownerPersonId: r.owner_person_id as string,
      createdBy: r.created_by as string,
      priority: r.priority as Task["priority"],
      kind: r.kind as Task["kind"],
      startDate: r.start_date as string,
      endDate: (r.end_date as string) ?? null,
      dueDate: (r.due_date as string) ?? null,
      dueTime: (r.due_time as string) ?? null,
      recurrence: (r.recurrence as Task["recurrence"]) ?? null,
      recurrenceDays: (r.recurrence_days as number[]) ?? null,
      recurrenceMonthDay: (r.recurrence_month_day as number) ?? null,
      proofRequired: r.proof_required as Task["proofRequired"],
      proofHint: (r.proof_hint as string) ?? null,
      metricLabel: (r.metric_label as string) ?? null,
      metricTarget: r.metric_target !== null ? Number(r.metric_target) : null,
      linkedType: (r.linked_type as Task["linkedType"]) ?? null,
      linkedId: (r.linked_id as string) ?? null,
      status: r.status as Task["status"],
      pausedUntil: (r.paused_until as string) ?? null,
      tags: (r.tags as string[]) ?? [],
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      owner: ownerRaw
        ? {
            id: ownerRaw.id as string,
            tenantSlug: ownerRaw.tenant_slug as string,
            name: ownerRaw.name as string,
            userId: (ownerRaw.user_id as string) ?? null,
            leadPersonId: (ownerRaw.lead_person_id as string) ?? null,
            active: ownerRaw.active as boolean,
            createdAt: ownerRaw.created_at as string,
          }
        : undefined,
      checklist: checksRaw
        .map((c) => ({
          id: c.id as string,
          tenantSlug: c.tenant_slug as string,
          taskId: c.task_id as string,
          position: c.position as number,
          label: c.label as string,
        }))
        .sort((a, b) => a.position - b.position),
    };

    return task;
  });
}

export async function getTaskById(
  client: SupabaseClient,
  tenantSlug: string,
  taskId: string
): Promise<Task | null> {
  const tasks = await listTasks(client, tenantSlug, { status: undefined });
  return tasks.find((t) => t.id === taskId) ?? null;
}

export async function createTask(
  client: SupabaseClient,
  tenantSlug: string,
  input: CreateTaskInput,
  createdBy: string
): Promise<Task> {
  const { data, error } = await client
    .from("tasks")
    .insert({
      tenant_slug: tenantSlug,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      owner_person_id: input.ownerPersonId,
      created_by: createdBy,
      priority: input.priority ?? "normal",
      kind: input.kind,
      start_date: input.startDate,
      end_date: input.endDate ?? null,
      due_date: input.dueDate ?? null,
      due_time: input.dueTime ?? null,
      recurrence: input.recurrence ?? null,
      recurrence_days: input.recurrenceDays ?? null,
      recurrence_month_day: input.recurrenceMonthDay ?? null,
      proof_required: input.proofRequired ?? "none",
      proof_hint: input.proofHint?.trim() ?? null,
      metric_label: input.metricLabel?.trim() ?? null,
      metric_target: input.metricTarget ?? null,
      linked_type: input.linkedType ?? null,
      linked_id: input.linkedId ?? null,
      tags: input.tags ?? [],
      status: "active",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create task: ${error?.message}`);
  }

  const taskId = data.id as string;

  // Insert checklist items if provided
  if (input.checklist && input.checklist.length > 0) {
    const checklistInserts = input.checklist.map((label, idx) => ({
      tenant_slug: tenantSlug,
      task_id: taskId,
      position: idx + 1,
      label: label.trim(),
    }));
    await client.from("task_checklist_items").insert(checklistInserts);
  }

  // Fetch full task
  const task = await getTaskById(client, tenantSlug, taskId);
  if (!task) throw new Error("Task created but could not be loaded");

  // Generate occurrences up to today + 7 days
  const timezone = await getTenantTimezone(client, tenantSlug);
  await generateOccurrencesForTask(client, task, timezone, 7);

  await logTaskEvent(client, tenantSlug, {
    taskId,
    actor: createdBy,
    action: "created",
    payload: { title: task.title, kind: task.kind },
  });

  return task;
}

export async function updateTask(
  client: SupabaseClient,
  tenantSlug: string,
  taskId: string,
  patch: UpdateTaskInput,
  updatedBy: string
): Promise<Task> {
  const existing = await getTaskById(client, tenantSlug, taskId);
  if (!existing) throw new Error("Task not found");

  const timezone = await getTenantTimezone(client, tenantSlug);
  const todayStr = getTenantToday(timezone);

  const updateFields: Record<string, unknown> = {};
  if (patch.title !== undefined) updateFields.title = patch.title.trim();
  if (patch.description !== undefined) updateFields.description = patch.description?.trim() ?? null;
  if (patch.ownerPersonId !== undefined) updateFields.owner_person_id = patch.ownerPersonId;
  if (patch.priority !== undefined) updateFields.priority = patch.priority;
  if (patch.kind !== undefined) updateFields.kind = patch.kind;
  if (patch.startDate !== undefined) updateFields.start_date = patch.startDate;
  if (patch.endDate !== undefined) updateFields.end_date = patch.endDate ?? null;
  if (patch.dueDate !== undefined) updateFields.due_date = patch.dueDate ?? null;
  if (patch.dueTime !== undefined) updateFields.due_time = patch.dueTime ?? null;
  if (patch.recurrence !== undefined) updateFields.recurrence = patch.recurrence ?? null;
  if (patch.recurrenceDays !== undefined) updateFields.recurrence_days = patch.recurrenceDays ?? null;
  if (patch.recurrenceMonthDay !== undefined) updateFields.recurrence_month_day = patch.recurrenceMonthDay ?? null;
  if (patch.proofRequired !== undefined) updateFields.proof_required = patch.proofRequired;
  if (patch.proofHint !== undefined) updateFields.proof_hint = patch.proofHint?.trim() ?? null;
  if (patch.metricLabel !== undefined) updateFields.metric_label = patch.metricLabel?.trim() ?? null;
  if (patch.metricTarget !== undefined) updateFields.metric_target = patch.metricTarget ?? null;
  if (patch.linkedType !== undefined) updateFields.linked_type = patch.linkedType ?? null;
  if (patch.linkedId !== undefined) updateFields.linked_id = patch.linkedId ?? null;
  if (patch.tags !== undefined) updateFields.tags = patch.tags;
  if (patch.status !== undefined) updateFields.status = patch.status;
  if (patch.pausedUntil !== undefined) updateFields.paused_until = patch.pausedUntil ?? null;

  const { error } = await client
    .from("tasks")
    .update(updateFields)
    .eq("id", taskId)
    .eq("tenant_slug", tenantSlug);

  if (error) throw new Error(`Failed to update task: ${error.message}`);

  // Rule: Changing owner updates today's pending occurrence and future occurrences
  if (patch.ownerPersonId && patch.ownerPersonId !== existing.ownerPersonId) {
    await client
      .from("task_occurrences")
      .update({ owner_person_id: patch.ownerPersonId })
      .eq("task_id", taskId)
      .gte("occurs_on", todayStr)
      .eq("status", "pending");

    await logTaskEvent(client, tenantSlug, {
      taskId,
      actor: updatedBy,
      action: "reassigned",
      payload: { previousOwner: existing.ownerPersonId, newOwner: patch.ownerPersonId },
    });
  }

  // Rule: Pausing task turns future pending occurrences in pause window into skipped
  if (patch.status === "paused") {
    let query = client
      .from("task_occurrences")
      .update({ status: "skipped" })
      .eq("task_id", taskId)
      .gte("occurs_on", todayStr)
      .eq("status", "pending");

    if (patch.pausedUntil) {
      query = query.lte("occurs_on", patch.pausedUntil);
    }
    await query;

    await logTaskEvent(client, tenantSlug, {
      taskId,
      actor: updatedBy,
      action: "paused",
      payload: { pausedUntil: patch.pausedUntil ?? null },
    });
  }

  // Rule: Checklist template changes apply to today's pending occurrence and the future only
  if (patch.checklist !== undefined) {
    // Delete existing template items
    await client.from("task_checklist_items").delete().eq("task_id", taskId);

    // Insert new template items
    if (patch.checklist.length > 0) {
      const newItems = patch.checklist.map((label, idx) => ({
        tenant_slug: tenantSlug,
        task_id: taskId,
        position: idx + 1,
        label: label.trim(),
      }));
      await client.from("task_checklist_items").insert(newItems);
    }

    // Refresh pending occurrences from today forward
    const { data: pendingOccs } = await client
      .from("task_occurrences")
      .select("id")
      .eq("task_id", taskId)
      .gte("occurs_on", todayStr)
      .eq("status", "pending");

    if (pendingOccs && pendingOccs.length > 0) {
      const occIds = pendingOccs.map((o) => o.id);
      // Delete their checks
      await client.from("task_occurrence_checks").delete().in("occurrence_id", occIds);

      // Re-insert new checks
      if (patch.checklist.length > 0) {
        const batchChecks: Array<{
          tenant_slug: string;
          occurrence_id: string;
          position: number;
          label: string;
          checked: boolean;
        }> = [];
        for (const occId of occIds) {
          patch.checklist.forEach((label, idx) => {
            batchChecks.push({
              tenant_slug: tenantSlug,
              occurrence_id: occId,
              position: idx + 1,
              label: label.trim(),
              checked: false,
            });
          });
        }
        await client.from("task_occurrence_checks").insert(batchChecks);
      }
    }
  }

  // Reload and regenerate occurrences if schedule or status changed
  const updated = await getTaskById(client, tenantSlug, taskId);
  if (!updated) throw new Error("Task updated but could not be loaded");

  if (patch.status === "active" || patch.startDate || patch.recurrence || patch.recurrenceDays) {
    await generateOccurrencesForTask(client, updated, timezone, 7);
  }

  await logTaskEvent(client, tenantSlug, {
    taskId,
    actor: updatedBy,
    action: "edited",
    payload: { patch },
  });

  return updated;
}

export async function archiveTask(
  client: SupabaseClient,
  tenantSlug: string,
  taskId: string,
  adminUserId: string
): Promise<void> {
  const { error } = await client
    .from("tasks")
    .update({ status: "archived" })
    .eq("id", taskId)
    .eq("tenant_slug", tenantSlug);

  if (error) throw new Error(`Failed to archive task: ${error.message}`);

  await logTaskEvent(client, tenantSlug, {
    taskId,
    actor: adminUserId,
    action: "archived",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Occurrences: Today & Completion Rules
// ─────────────────────────────────────────────────────────────────────────────

export async function getOccurrencesForDate(
  client: SupabaseClient,
  tenantSlug: string,
  dateStr: string,
  options?: { personId?: string }
): Promise<TaskOccurrence[]> {
  let query = client
    .from("task_occurrences")
    .select(`
      id,
      tenant_slug,
      task_id,
      owner_person_id,
      occurs_on,
      due_at,
      status,
      completed_at,
      completed_by,
      completed_late,
      proof_url,
      proof_note,
      proof_image_path,
      metric_value,
      excused_by,
      excused_reason,
      created_at,
      tasks (
        id,
        tenant_slug,
        title,
        description,
        owner_person_id,
        created_by,
        priority,
        kind,
        start_date,
        end_date,
        due_date,
        due_time,
        recurrence,
        recurrence_days,
        recurrence_month_day,
        proof_required,
        proof_hint,
        metric_label,
        metric_target,
        linked_type,
        linked_id,
        status,
        paused_until,
        tags,
        created_at,
        updated_at
      ),
      team_people (
        id,
        tenant_slug,
        name,
        user_id,
        lead_person_id,
        active,
        created_at
      ),
      task_occurrence_checks (
        id,
        tenant_slug,
        occurrence_id,
        position,
        label,
        checked,
        checked_at,
        checked_by
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .eq("occurs_on", dateStr)
    .neq("status", "skipped");

  if (options?.personId) {
    query = query.eq("owner_person_id", options.personId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  // Fetch completedBy profile names
  const completedByUserIds = [
    ...new Set(data.map((r) => r.completed_by as string).filter(Boolean)),
  ];

  const profileMap = new Map<string, { displayName: string | null; avatarUrl: string | null }>();
  if (completedByUserIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", completedByUserIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, {
        displayName: p.display_name ?? null,
        avatarUrl: p.avatar_url ?? null,
      });
    }
  }

  return data.map((r) => {
    const taskRaw = r.tasks as unknown as Record<string, unknown> | null;
    const ownerRaw = r.team_people as unknown as Record<string, unknown> | null;
    const checksRaw = (r.task_occurrence_checks as unknown as Array<Record<string, unknown>>) ?? [];

    const checks: TaskOccurrenceCheck[] = checksRaw
      .map((c) => ({
        id: c.id as string,
        tenantSlug: c.tenant_slug as string,
        occurrenceId: c.occurrence_id as string,
        position: c.position as number,
        label: c.label as string,
        checked: c.checked as boolean,
        checkedAt: (c.checked_at as string) ?? null,
        checkedBy: (c.checked_by as string) ?? null,
      }))
      .sort((a, b) => a.position - b.position);

    const occ: TaskOccurrence = {
      id: r.id as string,
      tenantSlug: r.tenant_slug as string,
      taskId: r.task_id as string,
      ownerPersonId: r.owner_person_id as string,
      occursOn: r.occurs_on as string,
      dueAt: r.due_at as string,
      status: r.status as OccurrenceStatus,
      completedAt: (r.completed_at as string) ?? null,
      completedBy: (r.completed_by as string) ?? null,
      completedLate: r.completed_late as boolean,
      proofUrl: (r.proof_url as string) ?? null,
      proofNote: (r.proof_note as string) ?? null,
      proofImagePath: (r.proof_image_path as string) ?? null,
      metricValue: r.metric_value !== null ? Number(r.metric_value) : null,
      excusedBy: (r.excused_by as string) ?? null,
      excusedReason: (r.excused_reason as string) ?? null,
      createdAt: r.created_at as string,
      checks,
      completedByProfile: r.completed_by ? profileMap.get(r.completed_by) : undefined,
      owner: ownerRaw
        ? {
            id: ownerRaw.id as string,
            tenantSlug: ownerRaw.tenant_slug as string,
            name: ownerRaw.name as string,
            userId: (ownerRaw.user_id as string) ?? null,
            leadPersonId: (ownerRaw.lead_person_id as string) ?? null,
            active: ownerRaw.active as boolean,
            createdAt: ownerRaw.created_at as string,
          }
        : undefined,
      task: taskRaw
        ? {
            id: taskRaw.id as string,
            tenantSlug: taskRaw.tenant_slug as string,
            title: taskRaw.title as string,
            description: (taskRaw.description as string) ?? null,
            ownerPersonId: taskRaw.owner_person_id as string,
            createdBy: taskRaw.created_by as string,
            priority: taskRaw.priority as Task["priority"],
            kind: taskRaw.kind as Task["kind"],
            startDate: taskRaw.start_date as string,
            endDate: (taskRaw.end_date as string) ?? null,
            dueDate: (taskRaw.due_date as string) ?? null,
            dueTime: (taskRaw.due_time as string) ?? null,
            recurrence: (taskRaw.recurrence as Task["recurrence"]) ?? null,
            recurrenceDays: (taskRaw.recurrence_days as number[]) ?? null,
            recurrenceMonthDay: (taskRaw.recurrence_month_day as number) ?? null,
            proofRequired: taskRaw.proof_required as Task["proofRequired"],
            proofHint: (taskRaw.proof_hint as string) ?? null,
            metricLabel: (taskRaw.metric_label as string) ?? null,
            metricTarget: taskRaw.metric_target !== null ? Number(taskRaw.metric_target) : null,
            linkedType: (taskRaw.linked_type as Task["linkedType"]) ?? null,
            linkedId: (taskRaw.linked_id as string) ?? null,
            status: taskRaw.status as Task["status"],
            pausedUntil: (taskRaw.paused_until as string) ?? null,
            tags: (taskRaw.tags as string[]) ?? [],
            createdAt: taskRaw.created_at as string,
            updatedAt: taskRaw.updated_at as string,
          }
        : undefined,
    };

    return occ;
  });
}

/**
 * Fetch Overdue occurrences (earlier days still pending)
 */
export async function getOverdueOccurrences(
  client: SupabaseClient,
  tenantSlug: string,
  todayStr: string,
  options?: { personId?: string }
): Promise<TaskOccurrence[]> {
  let query = client
    .from("task_occurrences")
    .select(`
      id,
      tenant_slug,
      task_id,
      owner_person_id,
      occurs_on,
      due_at,
      status,
      completed_at,
      completed_by,
      completed_late,
      proof_url,
      proof_note,
      proof_image_path,
      metric_value,
      excused_by,
      excused_reason,
      created_at,
      tasks (
        id,
        tenant_slug,
        title,
        description,
        owner_person_id,
        created_by,
        priority,
        kind,
        start_date,
        end_date,
        due_date,
        due_time,
        recurrence,
        recurrence_days,
        recurrence_month_day,
        proof_required,
        proof_hint,
        metric_label,
        metric_target,
        linked_type,
        linked_id,
        status,
        paused_until,
        tags,
        created_at,
        updated_at
      ),
      team_people (
        id,
        tenant_slug,
        name,
        user_id,
        lead_person_id,
        active,
        created_at
      ),
      task_occurrence_checks (
        id,
        tenant_slug,
        occurrence_id,
        position,
        label,
        checked,
        checked_at,
        checked_by
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .lt("occurs_on", todayStr)
    .eq("status", "pending")
    .order("occurs_on", { ascending: false });

  if (options?.personId) {
    query = query.eq("owner_person_id", options.personId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((r) => {
    const taskRaw = r.tasks as unknown as Record<string, unknown> | null;
    const ownerRaw = r.team_people as unknown as Record<string, unknown> | null;
    const checksRaw = (r.task_occurrence_checks as unknown as Array<Record<string, unknown>>) ?? [];

    return {
      id: r.id as string,
      tenantSlug: r.tenant_slug as string,
      taskId: r.task_id as string,
      ownerPersonId: r.owner_person_id as string,
      occursOn: r.occurs_on as string,
      dueAt: r.due_at as string,
      status: r.status as OccurrenceStatus,
      completedAt: null,
      completedBy: null,
      completedLate: false,
      proofUrl: null,
      proofNote: null,
      proofImagePath: null,
      metricValue: null,
      excusedBy: null,
      excusedReason: null,
      createdAt: r.created_at as string,
      checks: checksRaw.map((c) => ({
        id: c.id as string,
        tenantSlug: c.tenant_slug as string,
        occurrenceId: c.occurrence_id as string,
        position: c.position as number,
        label: c.label as string,
        checked: c.checked as boolean,
        checkedAt: (c.checked_at as string) ?? null,
        checkedBy: (c.checked_by as string) ?? null,
      })),
      owner: ownerRaw
        ? {
            id: ownerRaw.id as string,
            tenantSlug: ownerRaw.tenant_slug as string,
            name: ownerRaw.name as string,
            userId: (ownerRaw.user_id as string) ?? null,
            leadPersonId: (ownerRaw.lead_person_id as string) ?? null,
            active: ownerRaw.active as boolean,
            createdAt: ownerRaw.created_at as string,
          }
        : undefined,
      task: taskRaw
        ? {
            id: taskRaw.id as string,
            tenantSlug: taskRaw.tenant_slug as string,
            title: taskRaw.title as string,
            description: (taskRaw.description as string) ?? null,
            ownerPersonId: taskRaw.owner_person_id as string,
            createdBy: taskRaw.created_by as string,
            priority: taskRaw.priority as Task["priority"],
            kind: taskRaw.kind as Task["kind"],
            startDate: taskRaw.start_date as string,
            endDate: (taskRaw.end_date as string) ?? null,
            dueDate: (taskRaw.due_date as string) ?? null,
            dueTime: (taskRaw.due_time as string) ?? null,
            recurrence: (taskRaw.recurrence as Task["recurrence"]) ?? null,
            recurrenceDays: (taskRaw.recurrence_days as number[]) ?? null,
            recurrenceMonthDay: (taskRaw.recurrence_month_day as number) ?? null,
            proofRequired: taskRaw.proof_required as Task["proofRequired"],
            proofHint: (taskRaw.proof_hint as string) ?? null,
            metricLabel: (taskRaw.metric_label as string) ?? null,
            metricTarget: taskRaw.metric_target !== null ? Number(taskRaw.metric_target) : null,
            linkedType: (taskRaw.linked_type as Task["linkedType"]) ?? null,
            linkedId: (taskRaw.linked_id as string) ?? null,
            status: taskRaw.status as Task["status"],
            pausedUntil: (taskRaw.paused_until as string) ?? null,
            tags: (taskRaw.tags as string[]) ?? [],
            createdAt: taskRaw.created_at as string,
            updatedAt: taskRaw.updated_at as string,
          }
        : undefined,
    };
  });
}

/**
 * Toggle check item on an occurrence.
 */
export async function toggleChecklistItem(
  client: SupabaseClient,
  tenantSlug: string,
  checkId: string,
  checked: boolean,
  userId: string
): Promise<void> {
  await client
    .from("task_occurrence_checks")
    .update({
      checked,
      checked_at: checked ? new Date().toISOString() : null,
      checked_by: checked ? userId : null,
    })
    .eq("id", checkId)
    .eq("tenant_slug", tenantSlug);
}

/**
 * Complete an occurrence.
 * Enforces all Section 5 business rules:
 *   - Only owner, admin, or owner's lead can complete
 *   - If proofRequired != 'none', proof must be provided (URL must be valid)
 *   - All checklist items must be checked
 *   - Metric value logged if metric target exists
 *   - Late flag set if completing past due_at on same day
 *   - Sends Discord webhook if configured
 */
export async function completeOccurrence(
  client: SupabaseClient,
  tenantSlug: string,
  params: {
    occurrenceId: string;
    completedBy: string; // auth.users.id
    isAdmin?: boolean;
    proofUrl?: string | null;
    proofNote?: string | null;
    proofImagePath?: string | null;
    metricValue?: number | null;
  }
): Promise<{ ok: boolean; error?: string; occurrence?: TaskOccurrence }> {
  // Fetch occurrence with task, owner, and checks
  const { data: occRow, error: occErr } = await client
    .from("task_occurrences")
    .select(`
      id,
      tenant_slug,
      task_id,
      owner_person_id,
      occurs_on,
      due_at,
      status,
      tasks (
        id,
        title,
        kind,
        proof_required,
        proof_hint,
        metric_label,
        metric_target
      ),
      team_people (
        id,
        name,
        user_id,
        lead_person_id
      ),
      task_occurrence_checks (
        id,
        checked
      )
    `)
    .eq("id", params.occurrenceId)
    .eq("tenant_slug", tenantSlug)
    .single();

  if (occErr || !occRow) {
    return { ok: false, error: "Occurrence not found" };
  }

  const timezone = await getTenantTimezone(client, tenantSlug);
  const todayStr = getTenantToday(timezone);
  const occursOn = occRow.occurs_on as string;

  // Day constraint: can be completed until 23:59 of its day
  if (occursOn < todayStr && !params.isAdmin) {
    return { ok: false, error: "This task occurrence is from a past day and can only be changed by an admin" };
  }

  // Permission check:
  // Must be owner (user_id matches), lead, or admin
  const ownerPerson = occRow.team_people as unknown as {
    id: string;
    name: string;
    user_id: string | null;
    lead_person_id: string | null;
  };

  let hasPermission = Boolean(params.isAdmin);

  if (!hasPermission && ownerPerson.user_id === params.completedBy) {
    hasPermission = true;
  }

  if (!hasPermission && ownerPerson.lead_person_id) {
    // Check if caller is lead person
    const { data: leadPerson } = await client
      .from("team_people")
      .select("user_id")
      .eq("id", ownerPerson.lead_person_id)
      .single();
    if (leadPerson?.user_id === params.completedBy) {
      hasPermission = true;
    }
  }

  if (!hasPermission) {
    return { ok: false, error: "You do not have permission to complete this task for another team member" };
  }

  const task = occRow.tasks as unknown as {
    id: string;
    title: string;
    kind: string;
    proof_required: ProofRequired;
    proof_hint: string | null;
    metric_label: string | null;
    metric_target: number | null;
  };

  // Checklist validation: all items must be checked
  const checks = (occRow.task_occurrence_checks as unknown as Array<{ id: string; checked: boolean }>) ?? [];
  const unchecked = checks.filter((c) => !c.checked);
  if (unchecked.length > 0) {
    return { ok: false, error: `All checklist items must be ticked (${checks.length - unchecked.length} of ${checks.length} completed)` };
  }

  // Proof validation
  if (task.proof_required === "link") {
    const url = params.proofUrl?.trim();
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
      return { ok: false, error: "A valid link (starting with http:// or https://) is required as proof" };
    }
  } else if (task.proof_required === "note") {
    if (!params.proofNote?.trim()) {
      return { ok: false, error: "A written note is required as proof" };
    }
  } else if (task.proof_required === "image") {
    if (!params.proofImagePath?.trim()) {
      return { ok: false, error: "An image upload is required as proof" };
    }
  }

  // Late check: completed after due_at but same day
  const now = new Date();
  const dueAt = new Date(occRow.due_at as string);
  const isLate = now > dueAt && occursOn === todayStr;

  const updatePatch: Record<string, unknown> = {
    status: "done",
    completed_at: now.toISOString(),
    completed_by: params.completedBy,
    completed_late: isLate,
    proof_url: params.proofUrl?.trim() ?? null,
    proof_note: params.proofNote?.trim() ?? null,
    proof_image_path: params.proofImagePath?.trim() ?? null,
    metric_value: params.metricValue !== undefined ? params.metricValue : null,
  };

  const { error: updateErr } = await client
    .from("task_occurrences")
    .update(updatePatch)
    .eq("id", params.occurrenceId)
    .eq("tenant_slug", tenantSlug);

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  await logTaskEvent(client, tenantSlug, {
    taskId: occRow.task_id as string,
    occurrenceId: params.occurrenceId,
    actor: params.completedBy,
    action: "completed",
    payload: {
      completedLate: isLate,
      proofUrl: params.proofUrl,
      metricValue: params.metricValue,
    },
  });

  // Calculate streak to include in Discord notification
  let streakCount = 1;
  if (task.kind === "recurring") {
    const { data: pastOccs } = await client
      .from("task_occurrences")
      .select("occurs_on, status")
      .eq("task_id", occRow.task_id as string)
      .order("occurs_on", { ascending: true });

    if (pastOccs) {
      // Mock today as done
      const merged = pastOccs.map((o) => ({
        occursOn: o.occurs_on as string,
        status: o.occurs_on === occursOn ? ("done" as const) : (o.status as OccurrenceStatus),
      }));
      const { currentStreak } = calculateStreak(merged, todayStr);
      streakCount = currentStreak;
    }
  }

  // Discord notification
  const ownerName = ownerPerson.name;
  let discordMsg = `✅ ${ownerName} completed *${task.title}*`;
  if (task.kind === "recurring") {
    discordMsg += ` (streak ${streakCount} 🔥)`;
  }
  if (params.proofUrl) {
    discordMsg += `\nProof: ${params.proofUrl}`;
  }
  await notifyDiscordTask(client, tenantSlug, discordMsg);

  return { ok: true };
}

/**
 * Uncomplete an occurrence.
 * Allowed on same day for owner, or anytime for admin.
 */
export async function uncompleteOccurrence(
  client: SupabaseClient,
  tenantSlug: string,
  occurrenceId: string,
  userId: string,
  isAdmin: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { data: occRow, error } = await client
    .from("task_occurrences")
    .select(`
      id,
      task_id,
      occurs_on,
      status,
      team_people ( user_id )
    `)
    .eq("id", occurrenceId)
    .eq("tenant_slug", tenantSlug)
    .single();

  if (error || !occRow) return { ok: false, error: "Occurrence not found" };

  const timezone = await getTenantTimezone(client, tenantSlug);
  const todayStr = getTenantToday(timezone);
  const occursOn = occRow.occurs_on as string;

  const ownerPerson = occRow.team_people as unknown as { user_id: string | null };
  const isOwner = ownerPerson?.user_id === userId;

  if (!isAdmin && (!isOwner || occursOn !== todayStr)) {
    return { ok: false, error: "A member can only un-complete their own task on the same day" };
  }

  await client
    .from("task_occurrences")
    .update({
      status: "pending",
      completed_at: null,
      completed_by: null,
      completed_late: false,
    })
    .eq("id", occurrenceId)
    .eq("tenant_slug", tenantSlug);

  await logTaskEvent(client, tenantSlug, {
    taskId: occRow.task_id as string,
    occurrenceId,
    actor: userId,
    action: "uncompleted",
  });

  return { ok: true };
}

/**
 * Excuse a missed occurrence (Admin only, requires reason).
 */
export async function excuseOccurrence(
  client: SupabaseClient,
  tenantSlug: string,
  occurrenceId: string,
  adminUserId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  if (!reason?.trim()) {
    return { ok: false, error: "A reason is required to excuse a missed task" };
  }

  const { data: occRow, error } = await client
    .from("task_occurrences")
    .select("id, task_id, status")
    .eq("id", occurrenceId)
    .eq("tenant_slug", tenantSlug)
    .single();

  if (error || !occRow) return { ok: false, error: "Occurrence not found" };

  if (occRow.status !== "missed") {
    return { ok: false, error: "Only missed task occurrences can be excused" };
  }

  await client
    .from("task_occurrences")
    .update({
      status: "excused",
      excused_by: adminUserId,
      excused_reason: reason.trim(),
    })
    .eq("id", occurrenceId)
    .eq("tenant_slug", tenantSlug);

  await logTaskEvent(client, tenantSlug, {
    taskId: occRow.task_id as string,
    occurrenceId,
    actor: adminUserId,
    action: "excused",
    payload: { reason: reason.trim() },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaks and Breaches View (Accountability View)
// ─────────────────────────────────────────────────────────────────────────────

export async function getStreaksAndBreaches(
  client: SupabaseClient,
  tenantSlug: string,
  options?: { personId?: string; days?: number }
): Promise<PersonStreakGroup[]> {
  const days = options?.days ?? 30;
  const timezone = await getTenantTimezone(client, tenantSlug);
  const todayStr = getTenantToday(timezone);
  const startStr = addDays(todayStr, -(days - 1));
  const datesInRange = getDatesInRange(startStr, todayStr);

  const people = await getTenantPeople(client, tenantSlug, { activeOnly: false });
  const targetPeople = options?.personId
    ? people.filter((p) => p.id === options.personId)
    : people;

  const tasks = await listTasks(client, tenantSlug, {
    kind: "recurring",
    personId: options?.personId,
    status: undefined, // include active & paused
  });

  // Fetch occurrences in date range
  const { data: occData } = await client
    .from("task_occurrences")
    .select(`
      id,
      task_id,
      owner_person_id,
      occurs_on,
      status,
      completed_late,
      proof_url,
      proof_note,
      proof_image_path,
      metric_value
    `)
    .eq("tenant_slug", tenantSlug)
    .gte("occurs_on", addDays(startStr, -60)) // extra history for streak calculation
    .lte("occurs_on", todayStr);

  // Group occurrences by taskId
  const occsByTask = new Map<string, Array<Record<string, unknown>>>();
  for (const o of occData ?? []) {
    const list = occsByTask.get(o.task_id as string) ?? [];
    list.push(o);
    occsByTask.set(o.task_id as string, list);
  }

  const firstOfMonthStr = `${todayStr.slice(0, 7)}-01`;

  const groups: PersonStreakGroup[] = [];

  for (const person of targetPeople) {
    const personTasks = tasks.filter((t) => t.ownerPersonId === person.id);
    if (personTasks.length === 0) continue;

    const taskRows: TaskStreakRow[] = [];

    for (const task of personTasks) {
      const taskOccs = (occsByTask.get(task.id) ?? []).map((o) => ({
        id: o.id as string,
        occursOn: o.occurs_on as string,
        status: o.status as OccurrenceStatus,
        completedLate: o.completed_late as boolean,
        proofUrl: (o.proof_url as string) ?? null,
        proofNote: (o.proof_note as string) ?? null,
        proofImagePath: (o.proof_image_path as string) ?? null,
        metricValue: o.metric_value !== null ? Number(o.metric_value) : null,
      }));

      const occMap = new Map(taskOccs.map((o) => [o.occursOn, o]));

      // Build squares for the last 30 days
      const squares: StreakSquare[] = [];
      let scheduledCount = 0;
      let completedOrExcusedCount = 0;
      let breachesThisMonth = 0;

      for (const d of datesInRange) {
        const occ = occMap.get(d);
        const isScheduled = isTaskScheduledForDate(task, d);

        if (!occ && !isScheduled) {
          squares.push({ date: d, status: "none" });
          continue;
        }

        const status = occ?.status ?? (isScheduled ? "missed" : "none");
        if (status !== "none" && status !== "skipped") {
          scheduledCount++;
          if (status === "done" || status === "excused") {
            completedOrExcusedCount++;
          }
        }

        if (status === "missed" && d >= firstOfMonthStr) {
          breachesThisMonth++;
        }

        const belowTarget =
          status === "done" &&
          task.metricTarget !== null &&
          occ?.metricValue !== null &&
          occ?.metricValue !== undefined &&
          occ.metricValue < task.metricTarget;

        squares.push({
          date: d,
          status,
          occurrenceId: occ?.id,
          completedLate: occ?.completedLate,
          belowTarget,
          proofUrl: occ?.proofUrl,
          proofNote: occ?.proofNote,
          proofImagePath: occ?.proofImagePath,
          metricValue: occ?.metricValue,
          metricTarget: task.metricTarget,
          metricLabel: task.metricLabel,
        });
      }

      const { currentStreak, longestStreak } = calculateStreak(taskOccs, todayStr);
      const completionRate30d =
        scheduledCount > 0 ? Math.round((completedOrExcusedCount / scheduledCount) * 100) : 0;

      taskRows.push({
        task,
        currentStreak,
        longestStreak,
        completionRate30d,
        breachesThisMonth,
        squares,
      });
    }

    groups.push({ person, tasks: taskRows });
  }

  return groups;
}

/**
 * List missed occurrences (Breaches).
 */
export async function getBreaches(
  client: SupabaseClient,
  tenantSlug: string,
  from: string,
  to: string,
  personId?: string
): Promise<TaskOccurrence[]> {
  let query = client
    .from("task_occurrences")
    .select(`
      id,
      tenant_slug,
      task_id,
      owner_person_id,
      occurs_on,
      due_at,
      status,
      completed_at,
      completed_by,
      completed_late,
      proof_url,
      proof_note,
      proof_image_path,
      metric_value,
      excused_by,
      excused_reason,
      created_at,
      tasks (
        id,
        title,
        priority,
        kind
      ),
      team_people (
        id,
        name
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .eq("status", "missed")
    .gte("occurs_on", from)
    .lte("occurs_on", to)
    .order("occurs_on", { ascending: false });

  if (personId) {
    query = query.eq("owner_person_id", personId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((r) => {
    const taskRaw = r.tasks as unknown as Record<string, unknown> | null;
    const ownerRaw = r.team_people as unknown as Record<string, unknown> | null;

    return {
      id: r.id as string,
      tenantSlug: r.tenant_slug as string,
      taskId: r.task_id as string,
      ownerPersonId: r.owner_person_id as string,
      occursOn: r.occurs_on as string,
      dueAt: r.due_at as string,
      status: "missed" as const,
      completedAt: null,
      completedBy: null,
      completedLate: false,
      proofUrl: null,
      proofNote: null,
      proofImagePath: null,
      metricValue: null,
      excusedBy: null,
      excusedReason: null,
      createdAt: r.created_at as string,
      checks: [],
      owner: ownerRaw
        ? {
            id: ownerRaw.id as string,
            tenantSlug: tenantSlug,
            name: ownerRaw.name as string,
            userId: null,
            leadPersonId: null,
            active: true,
            createdAt: "",
          }
        : undefined,
      task: taskRaw
        ? {
            id: taskRaw.id as string,
            tenantSlug,
            title: taskRaw.title as string,
            description: null,
            ownerPersonId: r.owner_person_id as string,
            createdBy: "",
            priority: taskRaw.priority as Task["priority"],
            kind: taskRaw.kind as Task["kind"],
            startDate: "",
            endDate: null,
            dueDate: null,
            dueTime: null,
            recurrence: null,
            recurrenceDays: null,
            recurrenceMonthDay: null,
            proofRequired: "none",
            proofHint: null,
            metricLabel: null,
            metricTarget: null,
            linkedType: null,
            linkedId: null,
            status: "active",
            pausedUntil: null,
            tags: [],
            createdAt: "",
            updatedAt: "",
          }
        : undefined,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Standup Report + WhatsApp Copy
// ─────────────────────────────────────────────────────────────────────────────

export async function getStandupReport(
  client: SupabaseClient,
  tenantSlug: string,
  from: string,
  to: string,
  personId?: string
): Promise<StandupReport> {
  const timezone = await getTenantTimezone(client, tenantSlug);
  const people = await getTenantPeople(client, tenantSlug, { activeOnly: false });
  const targetPeople = personId ? people.filter((p) => p.id === personId) : people;

  // Occurrences in range
  const { data: occs } = await client
    .from("task_occurrences")
    .select(`
      id,
      task_id,
      owner_person_id,
      occurs_on,
      status,
      completed_at,
      proof_url,
      metric_value,
      tasks (
        id,
        title,
        kind,
        metric_label,
        metric_target
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .gte("occurs_on", from)
    .lte("occurs_on", to);

  // Open one-off tasks
  const { data: oneOffTasks } = await client
    .from("tasks")
    .select("id, title, owner_person_id, due_date, status")
    .eq("tenant_slug", tenantSlug)
    .eq("kind", "one_off")
    .eq("status", "active");

  const todayStr = getTenantToday(timezone);

  const peopleStats: StandupPersonStats[] = [];

  for (const person of targetPeople) {
    const personOccs = (occs ?? []).filter((o) => o.owner_person_id === person.id);

    // Completed tasks
    const completedTasks: StandupPersonStats["completedTasks"] = [];
    const recurringMap = new Map<string, { title: string; done: number; total: number }>();
    const breaches: StandupPersonStats["breaches"] = [];
    const metricMap = new Map<string, { total: number; target: number | null }>();

    for (const occ of personOccs) {
      const task = occ.tasks as unknown as {
        id: string;
        title: string;
        kind: string;
        metric_label: string | null;
        metric_target: number | null;
      };
      if (!task) continue;

      if (occ.status === "done") {
        completedTasks.push({
          title: task.title,
          completedAt: occ.completed_at as string,
          proofUrl: (occ.proof_url as string) ?? null,
          metricValue: occ.metric_value !== null ? Number(occ.metric_value) : null,
          metricLabel: task.metric_label,
        });
      }

      if (task.kind === "recurring") {
        const entry = recurringMap.get(task.id) ?? { title: task.title, done: 0, total: 0 };
        entry.total++;
        if (occ.status === "done" || occ.status === "excused") {
          entry.done++;
        }
        recurringMap.set(task.id, entry);
      }

      if (occ.status === "missed") {
        breaches.push({
          taskTitle: task.title,
          occursOn: occ.occurs_on as string,
        });
      }

      if (task.metric_label && occ.metric_value !== null) {
        const val = Number(occ.metric_value);
        const m = metricMap.get(task.metric_label) ?? { total: 0, target: task.metric_target };
        m.total += val;
        metricMap.set(task.metric_label, m);
      }
    }

    const recurringStats: StandupPersonStats["recurringStats"] = [];
    for (const [, val] of recurringMap) {
      recurringStats.push({
        taskTitle: val.title,
        done: val.done,
        total: val.total,
        rate: val.total > 0 ? Math.round((val.done / val.total) * 100) : 0,
      });
    }

    const metricTotals: StandupPersonStats["metricTotals"] = [];
    for (const [label, val] of metricMap) {
      metricTotals.push({
        label,
        total: val.total,
        target: val.target,
      });
    }

    // Open one-off tasks for this person
    const openOneOff: StandupPersonStats["openOneOffTasks"] = [];
    for (const t of (oneOffTasks ?? []).filter((o) => o.owner_person_id === person.id)) {
      const dueDate = t.due_date as string;
      const isOverdue = dueDate && dueDate < todayStr;
      const [y1, m1, d1] = (dueDate || todayStr).split("-").map(Number);
      const [y2, m2, d2] = todayStr.split("-").map(Number);
      const diffDays = Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / (24 * 3600 * 1000)));

      openOneOff.push({
        title: t.title as string,
        dueDate: dueDate ?? "No date",
        daysOverdue: isOverdue ? diffDays : 0,
      });
    }

    peopleStats.push({
      person,
      completedTasks,
      recurringStats,
      breaches,
      metricTotals,
      openOneOffTasks: openOneOff,
    });
  }

  // Format WhatsApp plain text (Section 6.4)
  // Clean WhatsApp formatting: *bold*, bullets, line breaks, NO markdown tables
  let whatsApp = `*Pulse Standup Report (${from} to ${to})*\n\n`;

  for (const p of peopleStats) {
    whatsApp += `*${p.person.name.toUpperCase()}*\n`;
    whatsApp += `• Completed tasks: ${p.completedTasks.length}\n`;

    if (p.recurringStats.length > 0) {
      whatsApp += `• Daily habits:\n`;
      for (const r of p.recurringStats) {
        whatsApp += `  - ${r.taskTitle}: ${r.done}/${r.total} (${r.rate}%)\n`;
      }
    }

    if (p.metricTotals.length > 0) {
      whatsApp += `• Metrics:\n`;
      for (const m of p.metricTotals) {
        const targetStr = m.target ? ` (target: ${m.target})` : "";
        whatsApp += `  - ${m.label}: ${m.total}${targetStr}\n`;
      }
    }

    if (p.breaches.length > 0) {
      whatsApp += `• Breaches (${p.breaches.length}):\n`;
      for (const b of p.breaches) {
        whatsApp += `  - ❌ ${b.taskTitle} on ${b.occursOn}\n`;
      }
    } else {
      whatsApp += `• Breaches: None (100% accountability! 🔥)\n`;
    }

    if (p.openOneOffTasks.length > 0) {
      whatsApp += `• Open one-off tasks:\n`;
      for (const o of p.openOneOffTasks) {
        const overdueStr = o.daysOverdue > 0 ? ` [⚠️ ${o.daysOverdue}d overdue]` : "";
        whatsApp += `  - ${o.title} (due: ${o.dueDate})${overdueStr}\n`;
      }
    }

    whatsApp += `\n`;
  }

  return {
    range: { from, to },
    people: peopleStats,
    whatsAppText: whatsApp.trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comments Thread & Leave Management
// ─────────────────────────────────────────────────────────────────────────────

export async function listTaskComments(
  client: SupabaseClient,
  tenantSlug: string,
  taskId: string
): Promise<TaskComment[]> {
  const { data, error } = await client
    .from("task_comments")
    .select(`
      id,
      tenant_slug,
      task_id,
      occurrence_id,
      author,
      body,
      created_at
    `)
    .eq("tenant_slug", tenantSlug)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const authorIds = [...new Set(data.map((c) => c.author as string))];
  const profileMap = new Map<string, { displayName: string; avatarUrl: string | null }>();
  if (authorIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", authorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, {
        displayName: p.display_name ?? "User",
        avatarUrl: p.avatar_url ?? null,
      });
    }
  }

  return data.map((c) => ({
    id: c.id as string,
    tenantSlug: c.tenant_slug as string,
    taskId: c.task_id as string,
    occurrenceId: (c.occurrence_id as string) ?? null,
    author: c.author as string,
    body: c.body as string,
    createdAt: c.created_at as string,
    authorProfile: profileMap.get(c.author),
  }));
}

export async function addTaskComment(
  client: SupabaseClient,
  tenantSlug: string,
  params: {
    taskId: string;
    occurrenceId?: string | null;
    author: string;
    body: string;
  }
): Promise<TaskComment> {
  const { data, error } = await client
    .from("task_comments")
    .insert({
      tenant_slug: tenantSlug,
      task_id: params.taskId,
      occurrence_id: params.occurrenceId ?? null,
      author: params.author,
      body: params.body.trim(),
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to add comment: ${error?.message}`);

  await logTaskEvent(client, tenantSlug, {
    taskId: params.taskId,
    occurrenceId: params.occurrenceId ?? null,
    actor: params.author,
    action: "commented",
  });

  return {
    id: data.id as string,
    tenantSlug: data.tenant_slug as string,
    taskId: data.task_id as string,
    occurrenceId: (data.occurrence_id as string) ?? null,
    author: data.author as string,
    body: data.body as string,
    createdAt: data.created_at as string,
  };
}

export async function recordPersonLeave(
  client: SupabaseClient,
  tenantSlug: string,
  params: {
    personId: string;
    startsOn: string;
    endsOn: string;
    reason?: string | null;
    createdBy: string;
  }
): Promise<PersonLeave> {
  const { data, error } = await client
    .from("person_leave")
    .insert({
      tenant_slug: tenantSlug,
      person_id: params.personId,
      starts_on: params.startsOn,
      ends_on: params.endsOn,
      reason: params.reason?.trim() ?? null,
      created_by: params.createdBy,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to record leave: ${error?.message}`);

  // Mark all pending occurrences in that window as skipped
  await client
    .from("task_occurrences")
    .update({ status: "skipped" })
    .eq("tenant_slug", tenantSlug)
    .eq("owner_person_id", params.personId)
    .gte("occurs_on", params.startsOn)
    .lte("occurs_on", params.endsOn)
    .eq("status", "pending");

  return {
    id: data.id as string,
    tenantSlug: data.tenant_slug as string,
    personId: data.person_id as string,
    startsOn: data.starts_on as string,
    endsOn: data.ends_on as string,
    reason: (data.reason as string) ?? null,
    createdBy: data.created_by as string,
    createdAt: data.created_at as string,
  };
}

export async function listTaskEvents(
  client: SupabaseClient,
  tenantSlug: string,
  taskId: string
): Promise<TaskEvent[]> {
  const { data, error } = await client
    .from("task_events")
    .select("id, tenant_slug, task_id, occurrence_id, actor, action, payload, created_at")
    .eq("tenant_slug", tenantSlug)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];

  const actorIds = [...new Set(data.map((e) => e.actor as string).filter(Boolean))];
  const profileMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.display_name ?? "User");
    }
  }

  return data.map((e) => ({
    id: e.id as number,
    tenantSlug: e.tenant_slug as string,
    taskId: (e.task_id as string) ?? null,
    occurrenceId: (e.occurrence_id as string) ?? null,
    actor: (e.actor as string) ?? null,
    action: e.action as string,
    payload: (e.payload as Record<string, unknown>) ?? null,
    createdAt: e.created_at as string,
    actorProfile: e.actor ? { displayName: profileMap.get(e.actor) ?? "User" } : undefined,
  }));
}
