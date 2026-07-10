import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { getBlogPostRecordApi } from "@/lib/services/blog-posts";
import { listBlogPostVersionsApi } from "@/lib/services/blog-versions";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "content:read", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  const post = await getBlogPostRecordApi(admin, tenantSlug, id);
  if (!post) return apiError(404, "Blog post not found", headers);

  const [latestVersion] = await listBlogPostVersionsApi(admin, tenantSlug, id, 1);
  return apiOk({ post, latestVersion: latestVersion ?? null }, headers);
}
