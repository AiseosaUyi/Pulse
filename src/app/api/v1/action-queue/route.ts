// The unified attention board — see src/lib/services/action-queue.ts for
// the grouping algorithm. Shared with the pulse_action_queue MCP tool.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { listActionQueue, type QueueKind, type QueuePriority, type QueueStatus } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const STATUSES = new Set(["open", "snoozed", "resolved", "dismissed"]);
const KINDS = new Set(["reply", "follow_up", "decision", "escalation", "opportunity", "chore"]);
const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "engage:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  if (status && !STATUSES.has(status)) return apiError(400, `Invalid status: ${status}`, headers);
  const kind = searchParams.get("kind");
  if (kind && !KINDS.has(kind)) return apiError(400, `Invalid kind: ${kind}`, headers);
  const priority = searchParams.get("priority");
  if (priority && !PRIORITIES.has(priority)) return apiError(400, `Invalid priority: ${priority}`, headers);

  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");

  const result = await listActionQueue(admin, tenantSlug, {
    status: (status as QueueStatus) ?? undefined,
    kind: (kind as QueueKind) ?? undefined,
    priority: (priority as QueuePriority) ?? undefined,
    assignedTo: searchParams.get("assignedTo") ?? undefined,
    platform: searchParams.get("platform") ?? undefined,
    since: searchParams.get("since") ?? undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
    offset: offsetRaw ? Number(offsetRaw) : undefined,
  });

  return apiOk(result, headers);
}
