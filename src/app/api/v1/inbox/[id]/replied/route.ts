// Mark an inbox item handled. Shared with the pulse_mark_replied MCP
// tool via services/engagement.ts.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { markInboxReplied } from "@/lib/services/engagement";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "engage:write", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  const result = await markInboxReplied(admin, tenantSlug, id);
  if (!result.ok) {
    return apiError(result.status, result.error ?? "Inbox item not found", headers);
  }
  return apiOk({ success: true }, headers);
}
