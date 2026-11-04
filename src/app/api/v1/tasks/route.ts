import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { requireTasksAuth } from "@/lib/api/tasks-auth";
import { createTask, listTasks, getTenantPeople, getStreaksAndBreaches } from "@/lib/services/tasks";
import type { CreateTaskInput } from "@/lib/types/tasks";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const auth = await requireTasksAuth(req, "tasks:read", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin } = auth.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const person = searchParams.get("person");
  const status = searchParams.get("status") as "active" | "paused" | "archived" | null;
  const kind = searchParams.get("kind") as "one_off" | "recurring" | null;
  const tag = searchParams.get("tag") ?? undefined;

  let personId: string | undefined;
  if (person) {
    const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
    const match = people.find(
      (p) => p.id === person || p.name.toLowerCase() === person.toLowerCase()
    );
    personId = match?.id ?? person;
  }

  const tasks = await listTasks(admin, tenantSlug, {
    personId,
    status: status ?? undefined,
    kind: kind ?? undefined,
    tag,
  });

  const streakGroups = await getStreaksAndBreaches(admin, tenantSlug, { personId });
  const streakMap = new Map<string, number>();
  for (const g of streakGroups) {
    for (const t of g.tasks) {
      streakMap.set(t.task.id, t.currentStreak);
    }
  }

  const augmented = tasks.map((t) => ({
    ...t,
    currentStreak: streakMap.get(t.id) ?? 0,
  }));

  return apiOk(augmented, headers);
}

export async function POST(req: Request) {
  const auth = await requireTasksAuth(req, "tasks:write", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin, userId } = auth.context;
  const headers = corsHeaders(METHODS);

  try {
    const body = (await req.json()) as CreateTaskInput;
    if (!body.title || !body.ownerPersonId || !body.startDate || !body.kind) {
      return apiError(400, "Missing required task fields (title, ownerPersonId, startDate, kind)", headers);
    }

    const task = await createTask(admin, tenantSlug, body, userId);
    return apiOk(task, headers, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create task";
    return apiError(400, message, headers);
  }
}
