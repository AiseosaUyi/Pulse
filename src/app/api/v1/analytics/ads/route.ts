import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listCampaignsApi } from "@/lib/services/campaigns";
import type { CampaignStatus } from "@/lib/types/campaigns";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const STATUSES: readonly CampaignStatus[] = ["draft", "active", "paused", "completed"];

function isCampaignStatus(v: string): v is CampaignStatus {
  return (STATUSES as readonly string[]).includes(v);
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
  const status = searchParams.get("status");
  if (status && !isCampaignStatus(status)) {
    return apiError(400, `Invalid status: ${status}`, headers);
  }

  const { data, total } = await listCampaignsApi(admin, tenantSlug, {
    status: (status ?? undefined) as CampaignStatus | undefined,
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}
