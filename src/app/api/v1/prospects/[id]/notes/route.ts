// Log a note on a prospect. Shared with the pulse_add_prospect_note
// MCP tool via services/outbound.ts (addProspectNoteAdmin).

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { addProspectNoteAdmin } from "@/lib/services/outbound";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  body: z.string().min(1),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "sales:write", METHODS);
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await addProspectNoteAdmin(admin, tenantSlug, id, parsed.data.body, createdBy);
  if ("error" in result) {
    const status = result.error === "Prospect not found" ? 404 : 500;
    return apiError(status, result.error, headers);
  }
  return apiOk(result, headers);
}
