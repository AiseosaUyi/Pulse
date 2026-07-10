// Record a successful manual post. Shared with the pulse_record_published
// MCP tool via services/scheduled-posts.ts.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { recordManualPublish } from "@/lib/services/scheduled-posts";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  platformPostId: z.string().min(1),
  platformPostUrl: z.string().min(1),
  postedAt: z.string().datetime().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "publish:write", METHODS);
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

  const result = await recordManualPublish(admin, tenantSlug, id, parsed.data);
  if (!result.ok) {
    return apiError(result.status, result.error, headers);
  }
  return apiOk({ success: true }, headers);
}
