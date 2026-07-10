// Comments + DMs needing a response. Shared with the pulse_inbox MCP
// tool via services/engagement.ts.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listInboxItems } from "@/lib/services/engagement";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const PLATFORMS = new Set(["instagram", "tiktok", "twitter", "linkedin"]);

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "engage:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);

  const platform = searchParams.get("platform");
  if (platform && !PLATFORMS.has(platform)) {
    return apiError(400, `Invalid platform: ${platform}`, headers);
  }
  const unansweredOnly = searchParams.get("unanswered") === "true";

  const { data, total } = await listInboxItems(admin, tenantSlug, {
    platform: platform ?? undefined,
    unansweredOnly,
    limit,
    offset,
  });

  const nextOffset = offset + data.length;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;
  return apiPaginated(data, nextCursor, headers);
}
