// Meta: resolve the token to its tenant + brand context. The first
// call a Cowork skill makes to ground itself.

import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getTenantMeta } from "@/lib/services/tenants";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, null, METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, scopes, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const [tenant, brand] = await Promise.all([
    getTenantMeta(admin, tenantSlug),
    getBrandContext(tenantSlug),
  ]);

  if (!tenant) {
    return apiError(404, "Tenant not found", headers);
  }

  return apiOk(
    {
      tenant,
      brandVoice: brand.voice,
      positioning: brand.positioning,
      scopes,
    },
    headers
  );
}
