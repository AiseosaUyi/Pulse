// Today's outreach queue — overdue, due today, new replies, going
// cold — so a skill knows who to chase without re-deriving the dates
// itself.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { getOutreachToday } from "@/lib/services/outreach-intelligence";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "sales:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;

  const data = await getOutreachToday(admin, tenantSlug);
  return apiOk(data, corsHeaders(METHODS));
}
