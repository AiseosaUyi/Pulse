// Record engagement observed on-platform. Shared with the
// pulse_record_post_metrics MCP tool via services/scheduled-posts.ts.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { recordManualMetrics } from "@/lib/services/scheduled-posts";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z
  .object({
    likes: z.number().int().min(0).optional(),
    comments: z.number().int().min(0).optional(),
    shares: z.number().int().min(0).optional(),
    saves: z.number().int().min(0).optional(),
    views: z.number().int().min(0).optional(),
    observedAt: z.string().datetime().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (v) => v.likes !== undefined || v.comments !== undefined || v.shares !== undefined || v.saves !== undefined || v.views !== undefined,
    { message: "At least one metric (likes/comments/shares/saves/views) is required" }
  );

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

  const result = await recordManualMetrics(admin, tenantSlug, id, parsed.data);
  if (!result.ok) {
    return apiError(result.status, result.error, headers);
  }
  return apiOk({ success: true }, headers);
}
