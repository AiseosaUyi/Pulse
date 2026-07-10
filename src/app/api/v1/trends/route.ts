import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listTrendScoutsApi } from "@/lib/services/trends";
import type { TrendPlatform, TrendSource } from "@/lib/types/trends";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const PLATFORMS: readonly TrendPlatform[] = ["instagram", "tiktok", "twitter"];
const SOURCES: readonly TrendSource[] = ["creative_center", "hashtag_scout", "manual"];

function isTrendPlatform(v: string): v is TrendPlatform {
  return (PLATFORMS as readonly string[]).includes(v);
}

function isTrendSource(v: string): v is TrendSource {
  return (SOURCES as readonly string[]).includes(v);
}

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

  const platform = searchParams.get("platform");
  if (platform && !isTrendPlatform(platform)) {
    return apiError(400, `Invalid platform: ${platform}`, headers);
  }
  const source = searchParams.get("source");
  if (source && !isTrendSource(source)) {
    return apiError(400, `Invalid source: ${source}`, headers);
  }

  const { data, total } = await listTrendScoutsApi(admin, tenantSlug, {
    platform: (platform ?? undefined) as TrendPlatform | undefined,
    source: (source ?? undefined) as TrendSource | undefined,
    includeDismissed: searchParams.get("includeDismissed") === "true",
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}
