// Transition a prospect's pipeline status, with a reason — how the
// sales skill records "went cold" / "re-engage" etc.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { setProspectStatus } from "@/lib/services/outbound";
import { PROSPECT_STATUSES } from "@/lib/types/outbound";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  status: z.enum(PROSPECT_STATUSES),
  reason: z.string().optional(),
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

  const result = await setProspectStatus(admin, tenantSlug, id, parsed.data.status, parsed.data.reason);
  if (!result.ok) {
    return apiError(500, result.error, headers);
  }
  return apiOk({ success: true }, headers);
}
