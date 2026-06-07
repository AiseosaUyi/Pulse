import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import { listBlogPostVersions } from "@/lib/services/blog-versions";
import { listBlogPostFeedback } from "@/lib/services/blog-feedback";
import { listDistributionsForBlogPost } from "@/lib/services/content-distributions";
import { BlogEditorPageClient } from "./client";

// Regenerate + iterate-to-90 can run for up to a minute. Mirror the
// list page's maxDuration so the regenerate CTA has runtime headroom.
export const maxDuration = 300;

export default async function BlogEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const post = await getBlogPostRecord(tenantSlug, id);
  if (!post) notFound();

  const [versions, feedback, distributions, user] = await Promise.all([
    listBlogPostVersions(tenantSlug, id),
    listBlogPostFeedback(tenantSlug, id),
    listDistributionsForBlogPost(tenantSlug, id),
    getCurrentUser(),
  ]);

  return (
    <BlogEditorPageClient
      post={post}
      tenantSlug={tenantSlug}
      versions={versions}
      feedback={feedback}
      distributions={distributions}
      profileDefaults={{
        author: user?.displayName ?? null,
        authorImage: user?.avatarUrl ?? null,
      }}
    />
  );
}
