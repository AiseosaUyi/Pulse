import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listIntelFeed } from "@/lib/services/intelligence";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const CONTENT_TYPES = new Set(["reel", "post", "story", "blog", "video", "thread"]);

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "intel:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);
  const contentType = searchParams.get("contentType");
  if (contentType && !CONTENT_TYPES.has(contentType)) {
    return apiError(400, `Invalid contentType: ${contentType}`, headers);
  }
  const since = searchParams.get("since") ?? undefined;

  const { data, total } = await listIntelFeed(admin, tenantSlug, {
    contentType: contentType ?? undefined,
    since,
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}
