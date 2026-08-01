import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { getAdCampaignRoas, getAdRoasSummary } from "@/lib/attribution/ads";

export const dynamic = "force-dynamic";
const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "analytics:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days")) || 30));

  const [summary, campaigns] = await Promise.all([getAdRoasSummary(tenantSlug, days), getAdCampaignRoas(tenantSlug, days)]);
  return apiOk({ summary, campaigns }, headers);
}
