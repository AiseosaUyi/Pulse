import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { getMyDay } from "@/lib/services/my-day";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "sales:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner") ?? "all";

  const result = await getMyDay(admin, tenantSlug, { owner });
  return apiOk(result, headers);
}
