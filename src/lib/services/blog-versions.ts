import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlogPostVersionRecord } from "@/lib/types/blog-posts";

interface Row {
  id: string;
  blog_post_id: string;
  tenant_slug: string;
  version_number: number;
  content_json: unknown | null;
  content_markdown: string | null;
  word_count: number;
  content_score: number | null;
  diff_summary: string | null;
  created_by: string | null;
  created_at: string;
}

function rowTo(row: Row): BlogPostVersionRecord {
  return {
    id: row.id,
    blogPostId: row.blog_post_id,
    tenantSlug: row.tenant_slug,
    versionNumber: row.version_number,
    contentJson: row.content_json ?? null,
    contentMarkdown: row.content_markdown ?? "",
    wordCount: row.word_count,
    contentScore: row.content_score ?? null,
    diffSummary: row.diff_summary ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

export async function listBlogPostVersions(
  tenantSlug: string,
  blogPostId: string,
  limit = 50
): Promise<BlogPostVersionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_post_versions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", blogPostId)
    .order("version_number", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function getBlogPostVersion(
  tenantSlug: string,
  versionId: string
): Promise<BlogPostVersionRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_post_versions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}

/** Client-injected twin of listBlogPostVersions() for /api/v1 + MCP. */
export async function listBlogPostVersionsApi(
  client: SupabaseClient,
  tenantSlug: string,
  blogPostId: string,
  limit = 1
): Promise<BlogPostVersionRecord[]> {
  const { data, error } = await client
    .from("blog_post_versions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", blogPostId)
    .order("version_number", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}
