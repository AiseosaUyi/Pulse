// Latest generated topical map (pre-stored, no LLM call on read).
// Regenerating a topical map costs a real gpt-4.1 call — that's
// deliberately not wired to this GET, same class of exclusion as
// prospects' draft-dm and content-calendar's brief generation.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getTopicalMapApi } from "@/lib/services/seo";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "seo:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const map = await getTopicalMapApi(admin, tenantSlug);
  if (!map) {
    return apiError(404, "No topical map generated yet for this tenant", headers);
  }
  return apiOk(map, headers);
}
