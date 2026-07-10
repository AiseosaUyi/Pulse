import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listSeoRecommendations } from "@/lib/services/seo";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const STATUSES = new Set(["surfaced", "applied", "dismissed", "snoozed"]);

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
  const status = searchParams.get("status");
  if (status && !STATUSES.has(status)) {
    return apiError(400, `Invalid status: ${status}`, headers);
  }

  const { data, total } = await listSeoRecommendations(admin, tenantSlug, {
    status: status ?? undefined,
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}
