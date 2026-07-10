import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { getOutboundFilters } from "@/lib/server/outbound-filters";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "sales:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug } = ctx.context;

  const filters = await getOutboundFilters(tenantSlug);
  return apiOk({ filters, fetchedAt: new Date().toISOString() }, corsHeaders(METHODS));
}
