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
        author: user?.displayName ?? null,
        authorImage: user?.avatarUrl ?? null,
      }}
    />
  );
}
