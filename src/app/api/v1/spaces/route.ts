// Initiates an X/Twitter Space capture. See src/lib/services/spaces.ts —
// shared with the pulse_capture_space MCP tool.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { captureSpaceInputSchema, createSpaceCaptureApi } from "@/lib/services/spaces";

export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "content:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin, createdBy } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = captureSpaceInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await createSpaceCaptureApi(admin, tenantSlug, createdBy, parsed.data);
  if ("error" in result) return apiError(result.status, result.error, headers);
  return apiOk(result, headers);
}
