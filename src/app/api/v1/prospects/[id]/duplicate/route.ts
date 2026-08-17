// Mark (or unmark, when duplicateOfId is null) a prospect as a duplicate
// of another. Never deletes a row — see migration 104_prospect_quality.sql.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { setProspectDuplicate } from "@/lib/services/outbound";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  duplicateOfId: z.string().uuid().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "sales:write", METHODS);
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await setProspectDuplicate(admin, tenantSlug, id, parsed.data.duplicateOfId);
  if (!result.ok) {
    const status = result.error === "Target prospect not found" ? 404 : 400;
    return apiError(status, result.error, headers);
  }
  return apiOk({ success: true }, headers);
}
