// Resolve a scheduled post's mediaPaths entry to a downloadable URL.
// Shared with the pulse_post_media MCP tool via services/media.ts.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { resolveTenantMediaKey } from "@/lib/services/media";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const apiCtx = await requireApiContext(req, "publish:read", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug } = apiCtx.context;
  const headers = corsHeaders(METHODS);

  const { path } = await ctx.params;
  const result = await resolveTenantMediaKey(tenantSlug, path);
  if ("error" in result) {
    return apiError(result.status, result.error, headers);
  }

  return apiOk(result, headers);
}
