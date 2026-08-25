// Marks an X/Twitter Space capture extracted. See
// src/lib/services/spaces.ts — shared with the pulse_complete_space
// MCP tool.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { completeSpaceCaptureApi } from "@/lib/services/spaces";

export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request, { params }: { params: Promise<{ captureId: string }> }) {
  const ctx = await requireApiContext(req, "content:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  // Next.js 15+ convention for dynamic route params
  const { captureId } = await params;

  const result = await completeSpaceCaptureApi(admin, tenantSlug, captureId);
  if ("error" in result) return apiError(result.status, result.error, headers);
  return apiOk(result, headers);
}
