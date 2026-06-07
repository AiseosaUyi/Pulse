"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { generateBlogPost, BlogGenerationError } from "@/lib/ai/generate-blog-post";
import { generateBlogIdeas, BlogIdeationError } from "@/lib/ai/blog-ideate";
import type {
  BlogType,
  FeatureMeta,
  GeneratedIdeaRow,
} from "@/lib/types/blog-ideation";
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
  targetKeyword: string,
  extras: {
    blogType?: BlogType;
    blogIdeaId?: string;
    featureMeta?: FeatureMeta | null;
  } = {}
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
      blog_type: extras.blogType ?? null,
      blog_idea_id: extras.blogIdeaId ?? null,
      feature_meta: extras.featureMeta ?? null,
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
    question?: string | null;
    author?: string | null;
    authorImage?: string | null;
    coverImage?: { url: string; fileName?: string | null; contentType?: string | null; alt?: string | null } | null;
    thumbnail?: { url: string; fileName?: string | null; contentType?: string | null; alt?: string | null } | null;
    tags?: string[];
    category?: string | null;
    authorBio?: string | null;
    authorTitle?: string | null;
    authorUrl?: string | null;
    publishedDate?: string | null;
    updatedDate?: string | null;
    noindex?: boolean;
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
  if (patch.question !== undefined) update.question = patch.question;
  if (patch.author !== undefined) update.author = patch.author;
  if (patch.authorImage !== undefined) update.author_image = patch.authorImage;
  if (patch.coverImage !== undefined) update.cover_image = patch.coverImage;
  if (patch.thumbnail !== undefined) update.thumbnail = patch.thumbnail;
  if (patch.tags !== undefined) update.tags = patch.tags;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.authorBio !== undefined) update.author_bio = patch.authorBio;
  if (patch.authorTitle !== undefined) update.author_title = patch.authorTitle;
  if (patch.authorUrl !== undefined) update.author_url = patch.authorUrl;
  if (patch.publishedDate !== undefined) update.published_date = patch.publishedDate;
  if (patch.updatedDate !== undefined) update.updated_date = patch.updatedDate;
  if (patch.noindex !== undefined) update.noindex = patch.noindex;
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

/**
 * Ideation step. Returns 3 candidate ideas (or 1 for feature
 * announcements) without committing a full blog post yet — the user
 * picks their favourite, then `commitBlogIdea` runs the full
 * generator. Each idea is persisted to `blog_post_ideas` so we can
 * audit + retry.
 */
export async function generateBlogIdeasAction(
  tenantSlug: string,
  input: {
    blogType: BlogType;
    feature?: FeatureMeta;
    extraContext?: string;
  }
): Promise<ActionResult<{ batchId: string; ideas: GeneratedIdeaRow[] }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  const user = await getCurrentUser();

  try {
    const result = await generateBlogIdeas({
      tenantSlug,
      blogType: input.blogType,
      feature: input.feature,
      extraContext: input.extraContext,
      createdBy: user?.id ?? null,
    });
    return { success: true, batchId: result.batchId, ideas: result.ideas };
  } catch (err) {
    if (err instanceof BlogIdeationError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Ideation failed",
    };
  }
}

/**
 * Commit a chosen idea → full blog post. Marks the picked idea
 * 'picked' and the rest of the batch 'dismissed' so they don't
 * keep showing up.
 */
export async function commitBlogIdea(
  tenantSlug: string,
  ideaId: string,
  input: {
    targetWordCount?: number;
    extraContext?: string;
  } = {}
): Promise<ActionResult<CreateBlogResult>> {
  const admin = createAdminClient();
  const { data: ideaRow, error: fetchErr } = await admin
    .from("blog_post_ideas")
    .select("*")
    .eq("id", ideaId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (fetchErr || !ideaRow) {
    return { success: false, error: "Idea not found" };
  }
  if (ideaRow.status !== "pending") {
    return {
      success: false,
      error: "This idea has already been picked or dismissed.",
    };
  }

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  const { voice, positioning } = await getBrandContext(tenantSlug);

  const featureMeta = (ideaRow.feature_meta as FeatureMeta | null) ?? null;
  const ideaContext = [
    `Premise: ${ideaRow.premise}`,
    ideaRow.angle ? `Angle: ${ideaRow.angle}` : null,
    ideaRow.trending_signal ? `Tied to trend: ${ideaRow.trending_signal}` : null,
    featureMeta
      ? `Feature: ${featureMeta.name} — ${featureMeta.about}. Audience: ${featureMeta.audience}. Benefits: ${featureMeta.benefits}`
      : null,
    input.extraContext ? `Extra: ${input.extraContext}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  try {
    const generation = await generateBlogPost({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      targetKeyword: ideaRow.target_keyword || ideaRow.title,
      titleOverride: ideaRow.title,
      improveTitle: true,
      extraContext: ideaContext,
      targetWordCount: input.targetWordCount,
    });

    const persistResult = await persistGeneratedPost(
      tenantSlug,
      tenant.name,
      tenant.domain,
      generation,
      ideaRow.target_keyword || ideaRow.title,
      {
        blogType: ideaRow.blog_type as BlogType,
        blogIdeaId: ideaRow.id as string,
        featureMeta,
      }
    );

    if (persistResult.success) {
      // Stamp the picked idea + dismiss its siblings.
      await admin
        .from("blog_post_ideas")
        .update({ status: "picked" })
        .eq("id", ideaRow.id);
      await admin
        .from("blog_post_ideas")
        .update({ status: "dismissed" })
        .eq("batch_id", ideaRow.batch_id)
        .eq("status", "pending");
    }

    return persistResult;
  } catch (err) {
    return { success: false, error: humanizeGenerationError(err) };
  }
}

export async function dismissBlogIdea(
  tenantSlug: string,
  ideaId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_post_ideas")
    .update({ status: "dismissed" })
    .eq("id", ideaId)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
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
