import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { composeAndSaveApi } from "@/lib/services/social-drafts";
import { composeModes } from "@/lib/ai/compose-take";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  mode: z.enum(composeModes),
  sourceUrl: z.string().min(1).optional(),
  angle: z.string().min(1).max(2000).optional(),
  focusPlatforms: z.array(z.string()).optional(),
});

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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await composeAndSaveApi(admin, tenantSlug, createdBy, parsed.data);
  if ("error" in result) {
    return apiError(400, result.error, headers);
  }
  return apiOk(result, headers);
}
