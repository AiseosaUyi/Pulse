"use server";

// Server actions for the SEO blog draft surface. Bridges the AI
// generator (generate-seo-blog.ts) and blog_posts (the editor's
// backing store, migration 015). Approval transitions live in
// seo-approvals.ts.
//
// Briefs (content_briefs) feed INTO blog_posts via brief_id — when a
// user generates from a brief, we create a fresh blog_post row linked
// back to the brief so we can trace the lineage.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  generateSeoBlog,
  SeoBlogGenerationError,
} from "@/lib/ai/seo/generate-seo-blog";
import { BudgetExceededError } from "@/lib/ai/ai-budget";
import { heuristicMap } from "@/lib/seo/gruve-discovery";
import { getTenantSeoConfig } from "@/lib/seo/tenant-seo-config";

export type SeoBlogActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string; reason?: SeoBlogErrorReason };

export type SeoBlogErrorReason =
  | "not_found"
  | "forbidden"
  | "budget_exceeded"
  | "generation_failed"
  | "no_tenant"
  | "no_keyword"
  | "unknown";

interface GenerateInput {
  postId: string;
  /** Override the keyword from the post if the user typed one in the UI. */
  primaryKeyword?: string;
}

// Word count of the rendered markdown body — light approximation, the
// score-blog deterministic SEO pass will compute the real number later.
function quickWordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

export async function generateSeoBlogForPost(
  input: GenerateInput
): Promise<SeoBlogActionResult<{ postId: string; version: number }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { success: false, error: "No active tenant", reason: "no_tenant" };
  }

  const supabase = await createClient();

  const { data: post, error: loadErr } = await supabase
    .from("blog_posts")
    .select(
      "id, tenant_slug, title, target_keyword, secondary_keywords, version, status, slug, question, category, author, author_image"
    )
    .eq("id", input.postId)
    .maybeSingle();

  if (loadErr || !post) {
    return { success: false, error: "Blog post not found", reason: "not_found" };
  }
  if (post.tenant_slug !== tenant.slug) {
    return { success: false, error: "Wrong tenant", reason: "forbidden" };
  }

  const primaryKeyword =
    input.primaryKeyword?.trim() ||
    post.target_keyword ||
    (Array.isArray(post.secondary_keywords) && post.secondary_keywords.length
      ? post.secondary_keywords[0]
      : null);

  if (!primaryKeyword) {
    return {
      success: false,
      error: "Set a target keyword before generating",
      reason: "no_keyword",
    };
  }

  try {
    const seo = await getTenantSeoConfig(tenant.slug);
    const draft = await generateSeoBlog({
      tenantSlug: tenant.slug,
      tenantName: tenant.name ?? tenant.slug,
      primaryKeyword,
      region: seo.serpRegion,
      brief: {
        title: post.title,
      },
    });

    // Map AI output to blog_posts columns. We write to both the legacy
    // columns (meta_description, target_keyword) and the new SEO columns
    // (seo_meta_*) so older readers still get sensible values.
    const outlineJsonb = draft.outline.map((s) => ({
      heading: s.h2,
      bullets: s.bullets.length > 0 ? s.bullets : s.h3s,
    }));

    // Auto-populate the SEO fields so the editor opens pre-filled. User-set
    // values are PRESERVED (slug/question/category/author only fill if empty);
    // generation outputs (excerpt/tags/faq) refresh each run.
    const tags = Array.from(
      new Set(
        [draft.primary_keyword, ...draft.secondary_keywords]
          .map((t) => t.trim())
          .filter(Boolean)
      )
    ).slice(0, 10);
    const firstFaqQuestion = draft.faq?.[0]?.question ?? null;
    const suggestedCategory = heuristicMap(draft.primary_keyword).category;

    const { data: updated, error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        title: draft.title,
        content: draft.body_markdown,
        target_keyword: draft.primary_keyword,
        secondary_keywords: draft.secondary_keywords,
        meta_description: draft.seo_meta_description,
        seo_meta_title: draft.seo_meta_title,
        seo_meta_description: draft.seo_meta_description,
        outline: outlineJsonb,
        word_count: quickWordCount(draft.body_markdown),
        version: post.version + 1,
        // Auto-populated SEO fields (slice 2/3).
        excerpt: draft.excerpt,
        slug: post.slug ?? draft.slug,
        tags,
        faq_items: draft.faq ?? [],
        question: post.question ?? firstFaqQuestion,
        category: post.category ?? suggestedCategory,
        // Author defaults from the signed-in user's profile, then the brand.
        author: post.author ?? user.displayName ?? tenant.name ?? null,
        author_image: post.author_image ?? user.avatarUrl ?? null,
        // Status stays where it was — generating doesn't change approval.
        // (A 'review' or 'in_review' post that gets regenerated drops
        // back to 'draft' to force a re-review — caller can decide.)
      })
      .eq("id", input.postId)
      .select("id, version")
      .single();

    if (updateErr || !updated) {
      return {
        success: false,
        error: updateErr?.message ?? "Update failed",
        reason: "unknown",
      };
    }

    revalidatePath("/seo-tracker/blog-writer/[id]", "page");
    return { success: true, postId: updated.id, version: updated.version };
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return {
        success: false,
        error: err.message,
        reason: "budget_exceeded",
      };
    }
    if (err instanceof SeoBlogGenerationError) {
      return {
        success: false,
        error: err.message,
        reason: "generation_failed",
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      reason: "unknown",
    };
  }
}

// Generate from scratch — creates a new blog_posts row + drafts in one call.
export async function generateSeoBlogFromKeyword(
  primaryKeyword: string,
  briefId?: string
): Promise<SeoBlogActionResult<{ postId: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { success: false, error: "No active tenant", reason: "no_tenant" };
  }
  if (!primaryKeyword.trim()) {
    return {
      success: false,
      error: "Primary keyword required",
      reason: "no_keyword",
    };
  }

  const supabase = await createClient();

  const { data: post, error: insertErr } = await supabase
    .from("blog_posts")
    .insert({
      tenant_slug: tenant.slug,
      title: primaryKeyword,
      target_keyword: primaryKeyword,
      status: "draft",
      created_by: user.id,
      brief_id: briefId ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !post) {
    return {
      success: false,
      error: insertErr?.message ?? "Could not create blog post",
      reason: "unknown",
    };
  }

  const generated = await generateSeoBlogForPost({
    postId: post.id,
    primaryKeyword,
  });

  if (!generated.success) {
    // Clean up the empty post so we don't leave orphans on failure.
    await supabase.from("blog_posts").delete().eq("id", post.id);
    return generated;
  }

  return { success: true, postId: post.id };
}

// Generate from a topic/article title with a distinct target keyword.
// Used by the topical map ("Generate draft" on a suggested article) and
// SERP analysis ("Create draft from gap"), where the human-facing title and
// the ranking keyword differ. Mirrors generateSeoBlogFromKeyword but lets
// the caller set the post title separately from the primary keyword.
export async function generateSeoBlogFromTopic(input: {
  title: string;
  primaryKeyword: string;
  briefId?: string;
}): Promise<SeoBlogActionResult<{ postId: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { success: false, error: "No active tenant", reason: "no_tenant" };
  }
  const title = input.title.trim();
  const primaryKeyword = input.primaryKeyword.trim();
  if (!primaryKeyword) {
    return {
      success: false,
      error: "Primary keyword required",
      reason: "no_keyword",
    };
  }

  const supabase = await createClient();

  const { data: post, error: insertErr } = await supabase
    .from("blog_posts")
    .insert({
      tenant_slug: tenant.slug,
      title: title || primaryKeyword,
      target_keyword: primaryKeyword,
      status: "draft",
      created_by: user.id,
      brief_id: input.briefId ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !post) {
    return {
      success: false,
      error: insertErr?.message ?? "Could not create blog post",
      reason: "unknown",
    };
  }

  const generated = await generateSeoBlogForPost({
    postId: post.id,
    primaryKeyword,
  });

  if (!generated.success) {
    await supabase.from("blog_posts").delete().eq("id", post.id);
    return generated;
  }

  return { success: true, postId: post.id };
}
