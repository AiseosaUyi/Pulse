import { cookies } from "next/headers";
import { listBlogPosts } from "@/lib/services/blog-posts";
import { listBlogPostVersions } from "@/lib/services/blog-versions";
import { listBlogPostFeedback } from "@/lib/services/blog-feedback";
import { getKeywordRankings } from "@/lib/services/seo";
import { getTenant } from "@/lib/services/tenants";
import { BlogWriterClient } from "./client";
import type {
  BlogPostFeedbackRecord,
  BlogPostVersionRecord,
} from "@/lib/types/blog-posts";

// The server action that creates a blog post runs the iterate-to-80
// loop — up to 3 refines + 2 expansions + scoring passes. Worst case
// can approach 60s on gpt-4.1. Give the page's function runtime room
// to breathe (Vercel's current default is 300s; set explicitly so
// this doesn't drift if defaults change).
export const maxDuration = 300;

export default async function BlogWriterPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [posts, keywords, tenant] = await Promise.all([
    listBlogPosts(tenantSlug),
    getKeywordRankings(tenantSlug),
    getTenant(tenantSlug),
  ]);

  const trackedKeywords = keywords.map((k) => k.keyword);

  // Pre-fetch versions + feedback for every post so the editor opens
  // instantly without a second round-trip. For larger blog archives
  // this list would get heavy; at current volumes it's fine, and
  // Phase E's dedup/trending work will force a pagination pass anyway.
  const postIds = posts.map((p) => p.id);
  const [versionsByPost, feedbackByPost] =
    postIds.length === 0
      ? [
          {} as Record<string, BlogPostVersionRecord[]>,
          {} as Record<string, BlogPostFeedbackRecord[]>,
        ]
      : await Promise.all([
          loadVersionsByPost(tenantSlug, postIds),
          loadFeedbackByPost(tenantSlug, postIds),
        ]);

  return (
    <BlogWriterClient
      posts={posts}
      tenantSlug={tenantSlug}
      tenantDomain={tenant?.domain ?? ""}
      trackedKeywords={trackedKeywords}
      versionsByPost={versionsByPost}
      feedbackByPost={feedbackByPost}
    />
  );
}

async function loadVersionsByPost(
  tenantSlug: string,
  postIds: string[]
): Promise<Record<string, BlogPostVersionRecord[]>> {
  const entries = await Promise.all(
    postIds.map(
      async (id) =>
        [id, await listBlogPostVersions(tenantSlug, id)] as const
    )
  );
  return Object.fromEntries(entries);
}

async function loadFeedbackByPost(
  tenantSlug: string,
  postIds: string[]
): Promise<Record<string, BlogPostFeedbackRecord[]>> {
  const entries = await Promise.all(
    postIds.map(
      async (id) =>
        [id, await listBlogPostFeedback(tenantSlug, id)] as const
    )
  );
  return Object.fromEntries(entries);
}
