import { cookies } from "next/headers";
import { listBlogPosts } from "@/lib/services/blog-posts";
import { getKeywordRankings } from "@/lib/services/seo";
import { BlogWriterClient } from "./client";

export default async function BlogWriterPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [posts, keywords] = await Promise.all([
    listBlogPosts(tenantSlug),
    getKeywordRankings(tenantSlug),
  ]);

  const trackedKeywords = keywords.map((k) => k.keyword);

  return (
    <BlogWriterClient
      posts={posts}
      tenantSlug={tenantSlug}
      trackedKeywords={trackedKeywords}
    />
  );
}
