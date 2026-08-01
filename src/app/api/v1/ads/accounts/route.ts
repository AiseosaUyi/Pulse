import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { listAdAccountsForTenant } from "@/lib/services/ad-accounts";

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

  const accounts = await listAdAccountsForTenant(tenantSlug);
  return apiOk({ data: accounts }, headers);
}
