// Competitor set. `platforms` on each row is a static, manually-set
// snapshot (handle/followers/engagementRate/lastChecked) — there is no
// "latest deltas" computation anywhere in the codebase to wrap, so this
// deliberately does NOT compute deltas (see docs/API-V1.md deviations).

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { listCompetitors } from "@/lib/services/intelligence";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "intel:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;

  const data = await listCompetitors(admin, tenantSlug);
  return apiOk({ data }, corsHeaders(METHODS));
}
