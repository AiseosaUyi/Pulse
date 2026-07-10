// Generate an on-brand reply draft. Shared with the pulse_reply_draft
// MCP tool via services/engagement.ts.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { draftAndSaveReply } from "@/lib/services/engagement";
import { getTenantMeta } from "@/lib/services/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const tenant = await getTenantMeta(admin, tenantSlug);
  if (!tenant) {
    return apiError(404, "Tenant not found", headers);
  }

  const result = await draftAndSaveReply(admin, tenantSlug, tenant.name, id);
  if ("error" in result) {
    return apiError(result.status, result.error, headers);
  }
  return apiOk(result, headers);
}
