// Non-message action items (decisions, escalations, opportunities, chores).
// Shared with the pulse_upsert_action_item MCP tool via
// services/action-queue.ts.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { listActionQueue, upsertActionItem, type QueueKind, type QueuePriority, type QueueStatus } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";
const KINDS = ["reply", "follow_up", "decision", "escalation", "opportunity", "chore"] as const;
const STATUSES = new Set(["open", "snoozed", "resolved", "dismissed"]);
const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);

const upsertSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  why: z.string().nullable().optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  platform: z.string().nullable().optional(),
  externalUrl: z.string().nullable().optional(),
  actionLabel: z.string().nullable().optional(),
  proposedReply: z.string().nullable().optional(),
  dedupeKey: z.string().min(1),
  prospectId: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
});

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
  if (kind && !(KINDS as readonly string[]).includes(kind)) return apiError(400, `Invalid kind: ${kind}`, headers);
  const priority = searchParams.get("priority");
  if (priority && !PRIORITIES.has(priority)) return apiError(400, `Invalid priority: ${priority}`, headers);

  const result = await listActionQueue(admin, tenantSlug, {
    status: (status as QueueStatus) ?? undefined,
    kind: (kind as QueueKind) ?? undefined,
    priority: (priority as QueuePriority) ?? undefined,
    assignedTo: searchParams.get("assignedTo") ?? undefined,
    platform: searchParams.get("platform") ?? undefined,
    since: searchParams.get("since") ?? undefined,
  });
  // Action-item-only view: drop rows the queue pulled from engagement/coach/prospects.
  const groups = result.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => r.source === "action") }));
  return apiOk({ groups, total: groups.reduce((sum, g) => sum + g.rows.length, 0) }, headers);
}

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "engage:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const result = await upsertActionItem(admin, tenantSlug, parsed.data);
  if (!result.ok) return apiError(500, result.error, headers);
  return apiOk(result, headers);
}
