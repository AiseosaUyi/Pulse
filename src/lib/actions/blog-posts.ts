"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { generateBlogPost, BlogGenerationError } from "@/lib/ai/generate-blog-post";
import { countWords } from "@/lib/blog/word-count";
import { buildGooglePreview } from "@/lib/blog/google-preview";
import { uniqueSlugFor } from "@/lib/blog/slug";
import type { BlogPostStatus } from "@/lib/types/blog-posts";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface CreateBlogResult {
  postId: string;
  wordCount: number;
  targetWordCount: number;
  wordCountWarning: boolean;
  contentScore: number | null;
  scoreWarning: boolean;
}

/**
 * Shared persistence path used by both the keyword-first
 * `generateBlogPostDraft` (legacy) and the flexible
 * `createManualBlogPost` (Phase C). Handles slug generation, Google
 * preview cache, score persistence.
 */
async function persistGeneratedPost(
  tenantSlug: string,
  tenantName: string,
  tenantDomain: string,
  generation: Awaited<ReturnType<typeof generateBlogPost>>,
  targetKeyword: string
): Promise<ActionResult<CreateBlogResult>> {
  const { post: draft, meta, score } = generation;

  const finalWordCount = countWords(draft.content);
  const wordCountWarning = meta.stopped_reason === "max_passes_reached";
  const scoreWarning = meta.score_warning === true;

  // Slug — derived from title, tenant-unique.
  const slug = await uniqueSlugFor(tenantSlug, draft.title);
  const googlePreview = buildGooglePreview({
    title: draft.title,
    metaDescription: draft.meta_description,
    slug,
    tenantDomain,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .insert({
      tenant_slug: tenantSlug,
      title: draft.title,
      slug,
      target_keyword: targetKeyword || null,
      secondary_keywords: draft.secondary_keywords,
      meta_description: draft.meta_description,
      outline: draft.outline,
      content: draft.content,
      word_count: finalWordCount,
      status: "draft",
      generator_model: "openai/gpt-4.1",
      generation_meta: meta,
      google_preview: googlePreview,
      content_score: score?.total ?? null,
      sub_scores: score?.subScores ?? null,
      score_issues: score?.issues ?? [],
      score_warning: scoreWarning,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  // Silence unused-var check: tenantName used elsewhere but we receive
  // it to keep the signature consistent with the generator input shape.
  void tenantName;

  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath("/seo-tracker");
  return {
    success: true,
    postId: data.id,
    wordCount: finalWordCount,
    targetWordCount: meta.target_word_count,
    wordCountWarning,
    contentScore: score?.total ?? null,
    scoreWarning,
  };
}

function humanizeGenerationError(err: unknown): string {
  if (err instanceof BlogGenerationError) return "AI generation failed. Please try again.";
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/**
 * Legacy keyword-first create. Keyword is required.
 * Used by the "Discover keywords → generate post" flow.
 */
export async function generateBlogPostDraft(
  tenantSlug: string,
  input: {
    targetKeyword: string;
    extraContext?: string;
    targetWordCount?: number;
  }
): Promise<ActionResult<CreateBlogResult>> {
  const keyword = input.targetKeyword.trim();
  if (!keyword) {
    return { success: false, error: "Target keyword is required" };
  }
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    const generation = await generateBlogPost({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      targetKeyword: keyword,
      extraContext: input.extraContext?.trim(),
      targetWordCount: input.targetWordCount,
    });
    return persistGeneratedPost(
      tenantSlug,
      tenant.name,
      tenant.domain,
      generation,
      keyword
    );
  } catch (err) {
    return { success: false, error: humanizeGenerationError(err) };
  }
}

/**
 * Phase C manual-create flow. Title / keyword / context are ALL
 * optional; the user must provide at least one so we have something
 * to write about. Brand Positioning + Voice always apply regardless.
 */
export async function createManualBlogPost(
  tenantSlug: string,
  input: {
    title?: string;
    improveTitle?: boolean;
    targetKeyword?: string;
    extraContext?: string;
    targetWordCount?: number;
  }
): Promise<ActionResult<CreateBlogResult>> {
  const title = input.title?.trim() ?? "";
  const keyword = input.targetKeyword?.trim() ?? "";
  const context = input.extraContext?.trim() ?? "";

  if (!title && !keyword && !context) {
    return {
      success: false,
      error:
        "Provide a title, a target keyword, or some context — we need something to write about.",
    };
  }

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    // If no keyword given, use the title as the AI's grounding topic.
    // Keyword placement scoring will flag this as a soft-issue but
    // the post itself generates cleanly.
    const groundingKeyword = keyword || title || context.slice(0, 60);

    const generation = await generateBlogPost({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      targetKeyword: groundingKeyword,
      titleOverride: title || undefined,
      // Default: if the user typed a title, AI polishes it unless they
      // explicitly unchecked the box. Null/undefined means no override
      // anyway so the flag is moot.
      improveTitle: title ? input.improveTitle !== false : undefined,
      extraContext: context || undefined,
      targetWordCount: input.targetWordCount,
    });

    return persistGeneratedPost(
      tenantSlug,
      tenant.name,
      tenant.domain,
      generation,
      keyword || groundingKeyword
    );
  } catch (err) {
    return { success: false, error: humanizeGenerationError(err) };
  }
}

export async function updateBlogPost(
  id: string,
  tenantSlug: string,
  patch: {
    title?: string;
    metaDescription?: string;
    content?: string;
    secondaryKeywords?: string[];
    status?: BlogPostStatus;
  }
): Promise<ActionResult> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.metaDescription !== undefined) update.meta_description = patch.metaDescription;
  if (patch.content !== undefined) {
    update.content = patch.content;
    update.word_count = countWords(patch.content);
  }
  if (patch.secondaryKeywords !== undefined) update.secondary_keywords = patch.secondaryKeywords;
  if (patch.status !== undefined) update.status = patch.status;
  if (Object.keys(update).length === 0) return { success: true };

  const { error } = await supabase
    .from("blog_posts")
    .update(update)
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath("/seo-tracker");
  return { success: true };
}

export async function deleteBlogPost(
  id: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_posts")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath("/seo-tracker");
  return { success: true };
}
