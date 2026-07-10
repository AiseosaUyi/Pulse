import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiPaginated, readPagination } from "@/lib/api/respond";
import { listKeywordRankingsApi } from "@/lib/services/seo";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "seo:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);

  const { data, total } = await listKeywordRankingsApi(admin, tenantSlug, { limit, offset });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}
