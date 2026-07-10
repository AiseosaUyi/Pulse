import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getDashboardStatsApi } from "@/lib/services/dashboard";

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

  const stats = await getDashboardStatsApi(admin, tenantSlug);
  if (!stats) {
    return apiError(404, "Tenant not found", headers);
  }
  return apiOk(stats, headers);
}
