// Set an inbox item's status. Shared with the pulse_set_queue_status MCP
// tool via services/action-queue.ts. POST /api/v1/inbox/:id/replied stays
// as a status:"resolved" alias for existing callers — this is the general
// form (open/snoozed/resolved/dismissed).

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { setQueueStatus } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "POST";

const statusSchema = z.object({
  status: z.enum(["open", "snoozed", "resolved", "dismissed"]),
  resolutionNote: z.string().optional(),
  snoozedUntil: z.string().optional(),
});

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "engage:write", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin, createdBy } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const result = await setQueueStatus(
    admin,
    tenantSlug,
    { source: "engagement", id },
    { ...parsed.data, resolvedBy: createdBy ?? undefined }
  );
  if (!result.ok) return apiError(result.status, result.error ?? "Update failed", headers);
  return apiOk({ success: true }, headers);
}
