// AI-draft an outbound DM for a prospect and save it. Mirrors
// /api/ext/draft-dm via the shared draftAndSaveDm() service helper.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { draftAndSaveDm } from "@/lib/services/outbound";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getTenantMeta } from "@/lib/services/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  context: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "sales:write", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  let body: unknown = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const tenant = await getTenantMeta(admin, tenantSlug);
  if (!tenant) {
    return apiError(404, "Tenant not found", headers);
  }

  const { voice, positioning } = await getBrandContext(tenantSlug);
  const result = await draftAndSaveDm(admin, tenantSlug, id, {
    tenantName: tenant.name,
    voice,
    positioning,
    context: parsed.data.context,
  });

  if (!result) {
    return apiError(404, "Prospect not found", headers);
  }
  if ("error" in result) {
    return apiError(500, result.error, headers);
  }
  return apiOk(result, headers);
}
