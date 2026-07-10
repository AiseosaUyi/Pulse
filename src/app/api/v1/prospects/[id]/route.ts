// Single prospect + full conversation thread (DMs, inbound messages,
// notes, AI analyses) so a skill has everything it needs for a
// tailored, non-spammy next move in one call.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getProspect } from "@/lib/services/outbound";
import { getConversationThread } from "@/lib/services/outreach-intelligence";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "sales:read", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);

  const { id } = await ctx.params;
  const prospect = await getProspect(admin, tenantSlug, id);
  if (!prospect) {
    return apiError(404, "Prospect not found", headers);
  }

  const thread = await getConversationThread(admin, tenantSlug, id);
  return apiOk({ prospect, thread }, headers);
}
