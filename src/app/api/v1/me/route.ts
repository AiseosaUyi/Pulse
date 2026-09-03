// Meta: resolve the token to its tenant + brand context. The first
// call a Cowork skill makes to ground itself. POST writes brand voice
// and/or positioning — scope admin, since it changes what every future AI
// call says on the tenant's behalf.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getBrandContext, setBrandPositioning } from "@/lib/ai/brand-positioning";
import { setBrandVoice } from "@/lib/ai/brand-voice";
import { getTenantMeta } from "@/lib/services/tenants";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";

const writeSchema = z
  .object({
    brandVoice: z.record(z.string(), z.unknown()).optional(),
    positioning: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.brandVoice !== undefined || v.positioning !== undefined, {
    message: "At least one of brandVoice or positioning is required",
  });

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

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "admin", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  if (parsed.data.brandVoice !== undefined) {
    const result = await setBrandVoice(admin, tenantSlug, parsed.data.brandVoice);
    if (!result.ok) return apiError(400, result.error, headers);
  }
  if (parsed.data.positioning !== undefined) {
    const result = await setBrandPositioning(admin, tenantSlug, parsed.data.positioning);
    if (!result.ok) return apiError(400, result.error, headers);
  }

  const brand = await getBrandContext(tenantSlug);
  return apiOk({ brandVoice: brand.voice, positioning: brand.positioning }, headers);
}
