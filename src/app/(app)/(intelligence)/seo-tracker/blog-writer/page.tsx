import { cookies } from "next/headers";
import { listBlogPosts } from "@/lib/services/blog-posts";
import { getKeywordRankings } from "@/lib/services/seo";
import { getTenant } from "@/lib/services/tenants";
import { BlogWriterClient } from "./client";

// The server action that creates a blog post runs the iterate-to-90
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

  return (
    <BlogWriterClient
      posts={posts}
      tenantSlug={tenantSlug}
      tenantDomain={tenant?.domain ?? ""}
      trackedKeywords={trackedKeywords}
    />
  );
}
