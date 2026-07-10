import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk, apiPaginated, readPagination } from "@/lib/api/respond";
import { listBlogPostsApi, createManualBlogPostApi } from "@/lib/services/blog-posts";
import type { BlogPostStatus } from "@/lib/types/blog-posts";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";
const STATUSES = new Set<BlogPostStatus>(["draft", "editing", "review", "published", "archived"]);

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
  if (status && !STATUSES.has(status as BlogPostStatus)) {
    return apiError(400, `Invalid status: ${status}`, headers);
  }

  const { data, total } = await listBlogPostsApi(admin, tenantSlug, {
    status: (status as BlogPostStatus | undefined) ?? undefined,
    limit,
    offset,
  });
  const nextOffset = offset + data.length;
  return apiPaginated(data, nextOffset < total ? String(nextOffset) : null, headers);
}

const createSchema = z.object({
  title: z.string().min(1).optional(),
  improveTitle: z.boolean().optional(),
  targetKeyword: z.string().min(1).optional(),
  extraContext: z.string().min(1).optional(),
  targetWordCount: z.number().int().min(200).max(5000).optional(),
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

  const result = await createManualBlogPostApi(admin, tenantSlug, parsed.data);
  if ("error" in result) {
    const status = result.error === "Tenant not found" ? 404 : 400;
    return apiError(status, result.error, headers);
  }
  return apiOk(result, headers);
}
