import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { requireTasksAuth } from "@/lib/api/tasks-auth";
import {
  archiveTask,
  getTaskById,
  listTaskComments,
  listTaskEvents,
  updateTask,
} from "@/lib/services/tasks";
import type { UpdateTaskInput } from "@/lib/types/tasks";

export const dynamic = "force-dynamic";

const METHODS = "GET, PATCH, DELETE";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const auth = await requireTasksAuth(req, "tasks:read", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin } = auth.context;
  const headers = corsHeaders(METHODS);

  const task = await getTaskById(admin, tenantSlug, id);
  if (!task) return apiError(404, "Task not found", headers);

  const [events, comments] = await Promise.all([
    listTaskEvents(admin, tenantSlug, id),
    listTaskComments(admin, tenantSlug, id),
  ]);

  return apiOk({ task, events, comments }, headers);
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const auth = await requireTasksAuth(req, "tasks:write", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin, userId } = auth.context;
  const headers = corsHeaders(METHODS);

  try {
    const body = (await req.json()) as UpdateTaskInput;
    const updated = await updateTask(admin, tenantSlug, id, body, userId);
    return apiOk(updated, headers);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update task";
    return apiError(400, message, headers);
  }
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const auth = await requireTasksAuth(req, "tasks:write", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin, userId, isAdmin } = auth.context;
  const headers = corsHeaders(METHODS);

  if (!isAdmin) {
    return apiError(403, "Only admins can archive tasks", headers);
  }

  try {
    await archiveTask(admin, tenantSlug, id, userId);
    return apiOk({ archived: true }, headers);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to archive task";
    return apiError(400, message, headers);
  }
}
