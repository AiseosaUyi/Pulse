// Approved/scheduled posts awaiting manual publishing by the
// browser-driven social manager. Shared with the pulse_publish_queue
// MCP tool via services/scheduled-posts.ts.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiPaginated, readPagination } from "@/lib/api/respond";
import { listPublishQueue } from "@/lib/services/scheduled-posts";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const PLATFORMS = new Set(["x", "linkedin", "instagram", "tiktok", "youtube"]);
const STATUSES = new Set(["draft", "scheduled", "publishing", "published", "failed"]);

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "publish:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);

  const platform = searchParams.get("platform");
  if (platform && !PLATFORMS.has(platform)) {
    return apiError(400, `Invalid platform: ${platform}`, headers);
  }

  const status = searchParams.get("status");
  if (status && !STATUSES.has(status)) {
    return apiError(400, `Invalid status: ${status}`, headers);
  }

  const due = searchParams.get("due") === "true";

  const { data, total } = await listPublishQueue(admin, tenantSlug, {
    platform: platform ?? undefined,
    status: status ?? undefined,
    due,
    limit,
    offset,
  });

  const nextOffset = offset + data.length;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;
  return apiPaginated(data, nextCursor, headers);
}
