import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { listAdAlerts } from "@/lib/services/ad-alerts";

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
  const unresolvedOnly = searchParams.get("unresolvedOnly") === "true";

  const alerts = await listAdAlerts(tenantSlug, { unresolvedOnly });
  return apiOk({ data: alerts }, headers);
}
