"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { countWords } from "@/lib/blog/word-count";
import { scoreBlogPost } from "@/lib/ai/score-blog";
import { getBrandContext } from "@/lib/ai/brand-positioning";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface SaveBlogContentInput {
  title?: string;
  metaDescription?: string | null;
  content: string;
  contentJson: unknown;
  /** Free-text one-liner describing the diff, shown in version history. */
  diffSummary?: string;
  /** Trigger rescore on save. Default: true. */
  rescore?: boolean;
}

export interface SaveBlogContentResult {
  versionId: string;
  versionNumber: number;
  wordCount: number;
  contentScore: number | null;
  scoreWarning: boolean;
}

/**
 * Phase D editor save path. Updates the blog_posts row, optionally
 * re-scores, and records the save as a new blog_post_versions row so
 * the user can diff + revert later. Version numbers are per-post
 * sequential; max+1 read lives inside this action (single-writer per
 * editor session, so no need for advisory locks).
 */
export async function saveBlogContent(
  postId: string,
  tenantSlug: string,
  input: SaveBlogContentInput
): Promise<ActionResult<SaveBlogContentResult>> {
  const supabase = await createClient();
  const user = await getCurrentUser();

  const wordCount = countWords(input.content);

  const patch: Record<string, unknown> = {
    content: input.content,
    content_json: input.contentJson,
    word_count: wordCount,
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.metaDescription !== undefined)
    patch.meta_description = input.metaDescription;

  const { error: updateErr } = await supabase
    .from("blog_posts")
    .update(patch)
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug);

  if (updateErr) return { success: false, error: updateErr.message };

  // Optional rescore — single gpt-4o-mini call + deterministic scorers.
  // Per-save cost is ~$0.003. Skip with rescore: false for deletes or
  // title-only tweaks where scoring would be wasted.
  let contentScore: number | null = null;
  let scoreWarning = false;
  if (input.rescore !== false) {
    const { data: row } = await supabase
      .from("blog_posts")
      .select(
        "title, meta_description, content, outline, target_keyword, secondary_keywords, slug, faq_schema, generation_meta"
      )
      .eq("id", postId)
      .eq("tenant_slug", tenantSlug)
      .maybeSingle();

    if (row) {
      try {
        const { voice, positioning } = await getBrandContext(tenantSlug);
        const targetWordCount =
          (row.generation_meta as { target_word_count?: number } | null)
            ?.target_word_count ?? 1200;

        const score = await scoreBlogPost({
          tenantSlug,
          post: {
            title: row.title as string,
            metaDescription: (row.meta_description ?? null) as string | null,
            content: (row.content ?? "") as string,
            outline: (row.outline ?? []) as Array<{
              heading: string;
              bullets: string[];
            }>,
            targetKeyword: (row.target_keyword ?? null) as string | null,
            secondaryKeywords: (row.secondary_keywords ?? []) as string[],
            slug: (row.slug ?? null) as string | null,
            faqSchema: row.faq_schema ?? null,
            targetWordCount,
          },
          voice,
          positioning,
        });

        contentScore = score.total;
        scoreWarning = score.total < 80;

        await supabase
          .from("blog_posts")
          .update({
            content_score: score.total,
            sub_scores: score.subScores,
            score_issues: score.issues,
            score_warning: scoreWarning,
          })
          .eq("id", postId)
          .eq("tenant_slug", tenantSlug);
      } catch {
        // Scoring is best-effort on save — if the AI call flakes
        // we still persist the edit rather than rolling back.
      }
    }
  }

  // Record version. Read max version_number and insert max+1.
  const { data: last } = await supabase
    .from("blog_post_versions")
    .select("version_number")
    .eq("blog_post_id", postId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = ((last?.version_number as number | undefined) ?? 0) + 1;

  const { data: inserted, error: versionErr } = await supabase
    .from("blog_post_versions")
    .insert({
      blog_post_id: postId,
      tenant_slug: tenantSlug,
      version_number: nextVersion,
      content_json: input.contentJson,
      content_markdown: input.content,
      word_count: wordCount,
      content_score: contentScore,
      diff_summary: input.diffSummary ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (versionErr || !inserted) {
    // Edit persisted, just couldn't version it. Surface softly.
    return {
      success: false,
      error: versionErr?.message ?? "Version insert failed",
    };
  }

  revalidatePath("/seo-tracker/blog-writer");

  return {
    success: true,
    versionId: inserted.id as string,
    versionNumber: nextVersion,
    wordCount,
    contentScore,
    scoreWarning,
  };
}

/**
 * Roll blog_posts row back to a prior version's content. Does NOT
 * rescore (the version's score travels with it); instead records a
 * new version so the revert itself is an audit trail entry.
 */
export async function revertToVersion(
  postId: string,
  tenantSlug: string,
  versionId: string
): Promise<ActionResult<{ versionNumber: number }>> {
  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data: version, error: vErr } = await supabase
    .from("blog_post_versions")
    .select("*")
    .eq("id", versionId)
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", postId)
    .maybeSingle();

  if (vErr || !version) {
    return { success: false, error: "Version not found" };
  }

  const content = (version.content_markdown ?? "") as string;
  const contentJson = version.content_json ?? null;
  const wordCount = (version.word_count ?? countWords(content)) as number;

  const { error: updateErr } = await supabase
    .from("blog_posts")
    .update({
      content,
      content_json: contentJson,
      word_count: wordCount,
      content_score: version.content_score ?? null,
    })
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug);

  if (updateErr) return { success: false, error: updateErr.message };

  const { data: last } = await supabase
    .from("blog_post_versions")
    .select("version_number")
    .eq("blog_post_id", postId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = ((last?.version_number as number | undefined) ?? 0) + 1;

  await supabase.from("blog_post_versions").insert({
    blog_post_id: postId,
    tenant_slug: tenantSlug,
    version_number: nextVersion,
    content_json: contentJson,
    content_markdown: content,
    word_count: wordCount,
    content_score: version.content_score ?? null,
    diff_summary: `Reverted to v${version.version_number}`,
    created_by: user?.id ?? null,
  });

  revalidatePath("/seo-tracker/blog-writer");
  return { success: true, versionNumber: nextVersion };
}
