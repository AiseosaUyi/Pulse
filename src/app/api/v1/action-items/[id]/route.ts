// Edit an action item's editable fields. Mirrors inbox/[id]/route.ts for
// the action_items table.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { setProposedReply, assignQueueRow, setPriority, setDueAt } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "PATCH";

const patchSchema = z.object({
  proposedReply: z.string().optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  dueAt: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
});

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "engage:write", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const rowRef = { source: "action" as const, id };
  const patch = parsed.data;

  if (patch.proposedReply !== undefined) {
    const r = await setProposedReply(admin, tenantSlug, rowRef, { text: patch.proposedReply, author: "human" });
    if (!r.ok) return apiError(r.status, r.error ?? "Update failed", headers);
  }
  if (patch.priority !== undefined) {
    const r = await setPriority(admin, tenantSlug, rowRef, patch.priority);
    if (!r.ok) return apiError(r.status, r.error ?? "Update failed", headers);
  }
  if (patch.dueAt !== undefined) {
    const r = await setDueAt(admin, tenantSlug, rowRef, patch.dueAt);
    if (!r.ok) return apiError(r.status, r.error ?? "Update failed", headers);
  }
  if (patch.assignedTo !== undefined) {
    const r = await assignQueueRow(admin, tenantSlug, rowRef, patch.assignedTo);
    if (!r.ok) return apiError(r.status, r.error ?? "Update failed", headers);
  }

  return apiOk({ success: true }, headers);
}
