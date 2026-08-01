import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { listCompetitorAds } from "@/lib/services/competitor-ads";

export const dynamic = "force-dynamic";
const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "intel:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const competitorId = searchParams.get("competitorId") ?? undefined;
  const activeOnly = searchParams.get("activeOnly") === "true";

  const ads = await listCompetitorAds(tenantSlug, { competitorId, activeOnly });
  return apiOk({ data: ads }, headers);
}
