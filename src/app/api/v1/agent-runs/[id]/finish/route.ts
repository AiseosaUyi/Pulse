// Close an agent run with a summary. Shared with the pulse_finish_run MCP
// tool.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { finishAgentRun } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "POST";

const finishSchema = z.object({
  summary: z.record(z.string(), z.unknown()).optional(),
});

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const parsed = finishSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const result = await finishAgentRun(admin, tenantSlug, id, parsed.data.summary ?? {});
  if (!result.ok) return apiError(result.status, "Run not found", headers);
  return apiOk({ success: true }, headers);
}
