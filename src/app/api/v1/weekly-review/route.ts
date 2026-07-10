// Pre-stored — no LLM call on read. Generation happens via a separate
// cron + src/lib/ai/weekly-review.ts.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getLatestWeeklyReviewApi } from "@/lib/services/weekly-reviews";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "analytics:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const review = await getLatestWeeklyReviewApi(admin, tenantSlug);
  if (!review) {
    return apiError(404, "No weekly review generated yet for this tenant", headers);
  }
  return apiOk(review, headers);
}
