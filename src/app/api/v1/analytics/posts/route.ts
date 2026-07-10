import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listOwnMetricsApi } from "@/lib/services/own-metrics";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const PLATFORMS: readonly OwnMetricsPlatform[] = ["instagram", "tiktok", "twitter", "linkedin"];

function isOwnMetricsPlatform(v: string): v is OwnMetricsPlatform {
  return (PLATFORMS as readonly string[]).includes(v);
}

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "analytics:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);
  const platform = searchParams.get("platform");
  if (platform && !isOwnMetricsPlatform(platform)) {
    return apiError(400, `Invalid platform: ${platform}`, headers);
  }
  const since = searchParams.get("since") ?? undefined;

  const { data, total } = await listOwnMetricsApi(admin, tenantSlug, {
    platform: (platform ?? undefined) as OwnMetricsPlatform | undefined,
    since,
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}
