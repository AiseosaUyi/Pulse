"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import {
  multiplyContent,
  ContentMultiplyError,
} from "@/lib/ai/multiply-content";
import {
  DISTRIBUTION_FORMATS,
  type ContentDistributionRecord,
  type DistributionFormat,
  type DistributionStatus,
} from "@/lib/types/content-distributions";
import { listDistributionsForBlogPost } from "@/lib/services/content-distributions";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * Generate all 8 distribution artifacts for a blog post and persist
 * them. Replaces any existing `draft` rows for this post so the user
 * can re-run multiply without accumulating stale drafts. Rows the
 * user has already approved/scheduled/published are preserved.
 */
export async function multiplyBlogPost(
  tenantSlug: string,
  blogPostId: string
): Promise<
  ActionResult<{ distributions: ContentDistributionRecord[]; costUsd: number }>
> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const post = await getBlogPostRecord(tenantSlug, blogPostId);
  if (!post) return { success: false, error: "Blog post not found" };

  if (!post.content || post.content.trim().length < 200) {
    return {
      success: false,
      error: "Blog post is too short to distribute (needs 200+ chars).",
    };
  }

  const { voice, positioning } = await getBrandContext(tenantSlug);

  let result;
  try {
    result = await multiplyContent({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      blog: {
        title: post.title,
        metaDescription: post.metaDescription,
        content: post.content,
        targetKeyword: post.targetKeyword,
      },
    });
  } catch (err) {
    const message =
      err instanceof ContentMultiplyError
        ? "AI distribution failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: message };
  }

  const supabase = await createClient();

  // Clear prior drafts only — keep approved/scheduled/published rows
  // so the user doesn't lose edits they've already committed to.
  const { error: delError } = await supabase
    .from("content_distributions")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", blogPostId)
    .eq("status", "draft");
  if (delError) {
    return { success: false, error: delError.message };
  }

  const rows = DISTRIBUTION_FORMATS.map((format) => ({
    tenant_slug: tenantSlug,
    blog_post_id: blogPostId,
    format,
    content: result.artifacts[format],
    status: "draft" as DistributionStatus,
    generator_model: result.model,
    generator_cost_usd: result.costUsd / DISTRIBUTION_FORMATS.length,
  }));

  const { error: insError } = await supabase
    .from("content_distributions")
    .insert(rows);
  if (insError) {
    return { success: false, error: insError.message };
  }

  const distributions = await listDistributionsForBlogPost(
    tenantSlug,
    blogPostId
  );

  revalidatePath(`/seo-tracker/blog-writer/${blogPostId}`);
  return { success: true, distributions, costUsd: result.costUsd };
}

export async function updateDistribution(
  tenantSlug: string,
  id: string,
  input: {
    content?: string;
    status?: DistributionStatus;
    scheduledAt?: string | null;
  }
): Promise<ActionResult<{ record: ContentDistributionRecord }>> {
  const patch: Record<string, unknown> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (input.status !== undefined) patch.status = input.status;
  if (input.scheduledAt !== undefined) patch.scheduled_at = input.scheduledAt;
  if (Object.keys(patch).length === 0) {
    return { success: false, error: "No changes" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_distributions")
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Update failed" };
  }

  return {
    success: true,
    record: {
      id: data.id,
      tenantSlug: data.tenant_slug,
      blogPostId: data.blog_post_id,
      format: data.format as DistributionFormat,
      content: data.content,
      status: data.status as DistributionStatus,
      scheduledAt: data.scheduled_at,
      generatorModel: data.generator_model,
      generatorCostUsd: Number(data.generator_cost_usd ?? 0),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
}

export async function deleteDistribution(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_distributions")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
