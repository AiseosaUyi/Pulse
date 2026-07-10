// Meta: machine-readable list of every /api/v1 endpoint, generated
// from a single source of truth (src/lib/api/manifest.ts) so it can't
// drift from the real routes. Skills self-discover capabilities here.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { API_V1_MANIFEST } from "@/lib/api/manifest";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, null, METHODS);
  if (!ctx.ok) return ctx.response;
  return apiOk({ version: "v1", endpoints: API_V1_MANIFEST }, corsHeaders(METHODS));
}
