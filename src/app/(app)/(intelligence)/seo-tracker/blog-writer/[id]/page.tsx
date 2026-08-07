import { getCurrentTenant } from "@/lib/auth";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import { listBlogPostVersions } from "@/lib/services/blog-versions";
import { listBlogPostFeedback } from "@/lib/services/blog-feedback";
import { listDistributionsForBlogPost } from "@/lib/services/content-distributions";
import { getTenant } from "@/lib/services/tenants";
import { listAuthors } from "@/lib/services/authors";
import { getTenantSeoConfig } from "@/lib/seo/tenant-seo-config";
import { getSucceededPublishTargets } from "@/lib/services/seo-publish-runs";
import { getBlogPublishRequirements } from "@/lib/actions/publish-to-gruve";
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
  const currentTenant = await getCurrentTenant();
  const tenantSlug = currentTenant?.slug ?? "";

  const post = await getBlogPostRecord(tenantSlug, id);
  if (!post) notFound();

  const [versions, feedback, distributions, user, tenant, authors, seo, succeededTargets, publishRequirements] =
    await Promise.all([
      listBlogPostVersions(tenantSlug, id),
      listBlogPostFeedback(tenantSlug, id),
      listDistributionsForBlogPost(tenantSlug, id),
      getCurrentUser(),
      getTenant(tenantSlug),
      listAuthors(tenantSlug),
      getTenantSeoConfig(tenantSlug),
      getSucceededPublishTargets(tenantSlug, id),
      getBlogPublishRequirements(tenantSlug),
    ]);

  // Prefer the current user's own author record (created_by = their user id)
  // so returning to a new post prefills title/bio/url too, not just name/image.
  // If they've created more than one, pick the most recently updated.
  const ownAuthor = authors
    .filter((a) => a.createdBy === user?.id)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;

  return (
    <BlogEditorPageClient
      post={post}
      tenantSlug={tenantSlug}
      versions={versions}
      feedback={feedback}
      distributions={distributions}
      authors={authors}
      categories={tenant?.blogCategories ?? []}
      siteDomain={tenant?.domain ?? null}
      seo={seo}
      succeededTargets={succeededTargets}
      questionRequired={publishRequirements.questionRequired}
      profileDefaults={{
        author: ownAuthor?.name ?? user?.displayName ?? null,
        authorImage: ownAuthor?.imageUrl ?? user?.avatarUrl ?? null,
        authorTitle: ownAuthor?.title ?? null,
        authorBio: ownAuthor?.bio ?? null,
        authorUrl: ownAuthor?.url ?? null,
      }}
    />
  );
}
