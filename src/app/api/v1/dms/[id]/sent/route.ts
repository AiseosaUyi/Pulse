// Mark a drafted DM as sent; cascades the prospect's pipeline stage.
// Mirrors /api/ext/dm/[id]/sent via the shared markDmSent() helper.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { markDmSent } from "@/lib/services/outbound";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "sales:write", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  const result = await markDmSent(admin, tenantSlug, id);
  if (!result) {
    return apiError(404, "DM not found", headers);
  }
  return apiOk({ success: true }, headers);
}
