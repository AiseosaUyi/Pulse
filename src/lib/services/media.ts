// Resolves a scheduled post's mediaPaths entry (an R2 storage key) to a
// downloadable URL for the browser-driven social manager. Shared by the
// REST /api/v1/media/*path route and the pulse_post_media MCP tool.

import { isR2Configured, r2ObjectExists, r2PublicUrl } from "@/lib/storage/r2";

// assets/{tenant}/..., videos/{tenant}/..., pipeline/{tenant}/..., thumbs/{tenant}/...
const KEY_CATEGORIES = new Set(["assets", "videos", "pipeline", "thumbs"]);

export async function resolveTenantMediaKey(
  tenantSlug: string,
  pathSegments: string[]
): Promise<{ url: string } | { error: string; status: 403 | 404 | 500 }> {
  const key = pathSegments.join("/");
  const [category, tenantSegment] = pathSegments;

  if (!KEY_CATEGORIES.has(category) || tenantSegment !== tenantSlug) {
    return { error: "Not this tenant's media", status: 403 };
  }

  if (!isR2Configured()) {
    return { error: "R2 not configured", status: 500 };
  }

  const exists = await r2ObjectExists(key);
  if (!exists) {
    return { error: "Media not found", status: 404 };
  }

  return { url: r2PublicUrl(key) };
}
