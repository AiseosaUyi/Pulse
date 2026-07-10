// Individual-persona feature — allowlist-gated the same way the app is
// (isContentCalendarEnabledForTenant), not just persona-gated. A token
// minted for a non-allowlisted tenant gets a 404, same as the page would.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { listContentSlotsApi } from "@/lib/services/content-calendar";
import { rolloverOverdueSlots, retireStaleSlots } from "@/lib/services/content-calendar-lifecycle";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "content:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  if (!isContentCalendarEnabledForTenant(tenantSlug)) {
    return apiError(404, "Content calendar not enabled for this tenant", headers);
  }

  await retireStaleSlots(admin, tenantSlug);
  await rolloverOverdueSlots(admin, tenantSlug);

  const slots = await listContentSlotsApi(admin, tenantSlug);
  return apiOk(slots, headers);
}
