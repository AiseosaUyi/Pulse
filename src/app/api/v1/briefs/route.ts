import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk, apiPaginated, readPagination } from "@/lib/api/respond";
import { listBriefsApi, generateAndSaveBrief } from "@/lib/services/briefs";
import type { ContentBriefStatus } from "@/lib/types/intelligence";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";
const STATUSES = new Set<ContentBriefStatus>(["draft", "approved", "published", "dismissed"]);

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "content:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);
  const status = searchParams.get("status");
  if (status && !STATUSES.has(status as ContentBriefStatus)) {
    return apiError(400, `Invalid status: ${status}`, headers);
  }

  const { data, total } = await listBriefsApi(admin, tenantSlug, {
    status: (status as ContentBriefStatus | undefined) ?? undefined,
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}

const createSchema = z.object({
  cardId: z.string().min(1),
});

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "content:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await generateAndSaveBrief(admin, tenantSlug, parsed.data.cardId);
  if ("error" in result) {
    const status = result.error === "Intel card not found" || result.error === "Tenant not found" ? 404 : 400;
    return apiError(status, result.error, headers);
  }
  return apiOk(result, headers);
}
