import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { getCampaignSummaryApi } from "@/lib/services/campaigns";

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

  const summary = await getCampaignSummaryApi(admin, tenantSlug);
  return apiOk(summary, headers);
}
