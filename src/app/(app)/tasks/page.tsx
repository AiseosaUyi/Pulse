import { redirect } from "next/navigation";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getBreaches,
  getOccurrencesForDate,
  getOverdueOccurrences,
  getStandupReport,
  getStreaksAndBreaches,
  getTenantPeople,
  getTenantTimezone,
} from "@/lib/services/tasks";
import { addDays, getTenantToday } from "@/lib/tasks/date-utils";
import { TasksView } from "@/components/tasks/TasksView";
import type { TaskOccurrence } from "@/lib/types/tasks";

export const metadata = {
  title: "Tasks & Habits",
};

export default async function TasksPage(props: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  const currentTenant = await getCurrentTenant();
  const user = await getCurrentUser();

  if (!currentTenant || !user) {
    redirect("/login");
  }

  const tenantSlug = currentTenant.slug;
  const isAdmin = currentTenant.role === "owner" || currentTenant.role === "admin";
  const supabase = await createClient();

  const timezone = await getTenantTimezone(supabase, tenantSlug);
  const todayStr = getTenantToday(timezone);

  // Calculate Monday of current week
  const [y, m, d] = todayStr.split("-").map(Number);
  const nowUtc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = nowUtc.getUTCDay(); // 0=Sun .. 6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mondayStr = addDays(todayStr, diffToMonday);

  // Parallel data loading
  const [
    people,
    overdueOccurrences,
    todayOccurrences,
    streakGroups,
    breaches,
    standupReport,
  ] = await Promise.all([
    getTenantPeople(supabase, tenantSlug),
    getOverdueOccurrences(supabase, tenantSlug, todayStr),
    getOccurrencesForDate(supabase, tenantSlug, todayStr),
    getStreaksAndBreaches(supabase, tenantSlug, { days: 30 }),
    getBreaches(supabase, tenantSlug, addDays(todayStr, -30), todayStr),
    getStandupReport(supabase, tenantSlug, mondayStr, todayStr),
  ]);

  // Occurrences for Board view (last 14 days up to today + 7 days)
  const boardStart = addDays(todayStr, -14);
  const boardEnd = addDays(todayStr, 7);
  const { data: boardRaw } = await supabase
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
        tags,
        linked_type,
        linked_id,
        status
      ),
      team_people (
        id,
        name
      )
    `)
    .eq("tenant_slug", tenantSlug)
    .gte("occurs_on", boardStart)
    .lte("occurs_on", boardEnd)
    .neq("status", "skipped");

  const boardOccurrences = (boardRaw ?? []).map((r) => {
    const taskRaw = r.tasks as unknown as Record<string, unknown> | null;
    const ownerRaw = r.team_people as unknown as Record<string, unknown> | null;
    return {
      id: r.id as string,
      tenantSlug: r.tenant_slug as string,
      taskId: r.task_id as string,
      ownerPersonId: r.owner_person_id as string,
      occursOn: r.occurs_on as string,
      dueAt: r.due_at as string,
      status: r.status as TaskOccurrence["status"],
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
      checks: [],
      owner: ownerRaw
        ? {
            id: ownerRaw.id as string,
            tenantSlug,
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
            description: (taskRaw.description as string) ?? null,
            ownerPersonId: r.owner_person_id as string,
            createdBy: "",
            priority: (taskRaw.priority as TaskOccurrence["task"] extends undefined ? never : any) ?? "normal",
            kind: (taskRaw.kind as any) ?? "recurring",
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
            linkedType: (taskRaw.linked_type as any) ?? null,
            linkedId: (taskRaw.linked_id as string) ?? null,
            status: "active",
            pausedUntil: null,
            tags: (taskRaw.tags as string[]) ?? [],
            createdAt: "",
            updatedAt: "",
          }
        : undefined,
    };
  });

  // Streaks lookup by taskId
  const streaksByTaskId: Record<string, number> = {};
  for (const g of streakGroups) {
    for (const t of g.tasks) {
      streaksByTaskId[t.task.id] = t.currentStreak;
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <TasksView
        initialTab={searchParams.tab || "today"}
        people={people}
        overdueOccurrences={overdueOccurrences}
        todayOccurrences={todayOccurrences}
        boardOccurrences={boardOccurrences as TaskOccurrence[]}
        streakGroups={streakGroups}
        breaches={breaches}
        standupReport={standupReport}
        streaksByTaskId={streaksByTaskId}
        isAdmin={isAdmin}
        currentUserId={user.id}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
