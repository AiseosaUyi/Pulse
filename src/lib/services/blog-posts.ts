import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BlogGenerationMeta,
  BlogGooglePreview,
  BlogImageRef,
  BlogPostRecord,
  BlogPostStatus,
  BlogPostOutlineItem,
  BlogScoreIssue,
  BlogSubScores,
  DraftSection,
} from "@/lib/types/blog-posts";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { generateBlogPost, BlogGenerationError } from "@/lib/ai/generate-blog-post";
import { countWords } from "@/lib/blog/word-count";
import { buildGooglePreview } from "@/lib/blog/google-preview";
import { uniqueSlugFor } from "@/lib/blog/slug";
import { scanBlogContent, type ContentFlag } from "@/lib/blog/content-flags";

interface Row {
  id: string;
  tenant_slug: string;
  title: string;
  slug: string | null;
  target_keyword: string | null;
  secondary_keywords: string[] | null;
  meta_description: string | null;
  question: string | null;
  author: string | null;
  author_image: string | null;
  cover_image: BlogImageRef | null;
  thumbnail: BlogImageRef | null;
  tags: string[] | null;
  category: string | null;
  author_bio: string | null;
  author_title: string | null;
  author_url: string | null;
  published_date: string | null;
  updated_date: string | null;
  noindex: boolean | null;
  outline: BlogPostOutlineItem[] | null;
  content: string | null;
  content_json: unknown | null;
  word_count: number;
  status: BlogPostStatus;
  generator_model: string | null;
  generation_meta: BlogGenerationMeta | null;
  content_score: number | null;
  sub_scores: BlogSubScores | null;
  score_issues: BlogScoreIssue[] | null;
  score_warning: boolean | null;
  faq_schema: unknown | null;
  faq_items: Array<{ question: string; answer: string }> | null;
  google_preview: BlogGooglePreview | null;
  content_flags: ContentFlag[] | null;
  content_flags_cleared: boolean | null;
  draft_sections: DraftSection[] | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

function rowTo(row: Row): BlogPostRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    title: row.title,
    slug: row.slug ?? null,
    targetKeyword: row.target_keyword,
    secondaryKeywords: row.secondary_keywords ?? [],
    metaDescription: row.meta_description,
    question: row.question ?? null,
    author: row.author ?? null,
    authorImage: row.author_image ?? null,
    coverImage: row.cover_image ?? null,
    thumbnail: row.thumbnail ?? null,
    tags: row.tags ?? [],
    category: row.category ?? null,
    authorBio: row.author_bio ?? null,
    authorTitle: row.author_title ?? null,
    authorUrl: row.author_url ?? null,
    publishedDate: row.published_date ?? null,
    updatedDate: row.updated_date ?? null,
    noindex: row.noindex ?? false,
    outline: row.outline ?? [],
    content: row.content ?? "",
    contentJson: row.content_json ?? null,
    wordCount: row.word_count,
    status: row.status,
    generatorModel: row.generator_model,
    generationMeta: row.generation_meta ?? null,
    contentScore: row.content_score ?? null,
    subScores: row.sub_scores ?? null,
    scoreIssues: row.score_issues ?? [],
    scoreWarning: row.score_warning ?? false,
    faqSchema: row.faq_schema ?? null,
    faqItems: row.faq_items ?? [],
    googlePreview: row.google_preview ?? null,
    contentFlags: row.content_flags ?? [],
    contentFlagsCleared: row.content_flags_cleared ?? false,
    draftSections: row.draft_sections ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? null,
  };
}

export async function listBlogPosts(
  tenantSlug: string,
  options: { status?: BlogPostStatus; limit?: number } = {}
): Promise<BlogPostRecord[]> {
  const supabase = await createClient();
  let query = supabase
    .from("blog_posts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.status) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function getBlogPostRecord(
  tenantSlug: string,
  id: string
): Promise<BlogPostRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}

/** Client-injected, offset-paginated twin of listBlogPosts() for
 * /api/v1 + MCP. */
export async function listBlogPostsApi(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { status?: BlogPostStatus; limit?: number; offset?: number } = {}
): Promise<{ data: BlogPostRecord[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  let query = client
    .from("blog_posts")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };
  return { data: (data as Row[]).map(rowTo), total: count ?? 0 };
}

/** Client-injected twin of getBlogPostRecord() for /api/v1 + MCP. */
export async function getBlogPostRecordApi(
  client: SupabaseClient,
  tenantSlug: string,
  id: string
): Promise<BlogPostRecord | null> {
  const { data, error } = await client
    .from("blog_posts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}

export interface CreateBlogResultApi {
  postId: string;
  wordCount: number;
  targetWordCount: number;
  wordCountWarning: boolean;
  contentScore: number | null;
  scoreWarning: boolean;
}

/** Client-injected twin of createManualBlogPost() + its
 * persistGeneratedPost() helper (actions/blog-posts.ts) — that file is
 * `"use server"`, so its exports can't take a SupabaseClient param.
 * Duplicates the exact logic: title/keyword/context all optional (at
 * least one required), heavy AI-writing (real gpt-4.1 multi-pass
 * generation, same cost class as prospects/:id/draft-dm — not free to
 * test). Uses a thin admin tenant lookup instead of getTenant()
 * (hardcoded SSR client, ~30 call sites, deliberately not refactored). */
export async function createManualBlogPostApi(
  client: SupabaseClient,
  tenantSlug: string,
  input: { title?: string; improveTitle?: boolean; targetKeyword?: string; extraContext?: string; targetWordCount?: number }
): Promise<CreateBlogResultApi | { error: string }> {
  const title = input.title?.trim() ?? "";
  const keyword = input.targetKeyword?.trim() ?? "";
  const context = input.extraContext?.trim() ?? "";
  if (!title && !keyword && !context) {
    return { error: "Provide a title, a target keyword, or some context — we need something to write about." };
  }

  const { data: tenantRow } = await client
    .from("tenants")
    .select("name, settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (!tenantRow) return { error: "Tenant not found" };
  const tenantName = tenantRow.name as string;
  const tenantDomain = ((tenantRow.settings as { domain?: string } | null)?.domain) ?? "";

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    const groundingKeyword = keyword || title || context.slice(0, 60);
    const generation = await generateBlogPost({
      tenantSlug,
      tenantName,
      voice,
      positioning,
      targetKeyword: groundingKeyword,
      titleOverride: title || undefined,
      improveTitle: title ? input.improveTitle !== false : undefined,
      extraContext: context || undefined,
      targetWordCount: input.targetWordCount,
    });

    const { post: draft, meta, score } = generation;
    const finalWordCount = countWords(draft.content);
    const wordCountWarning = meta.stopped_reason === "max_passes_reached";
    const scoreWarning = meta.score_warning === true;
    const contentFlags = scanBlogContent(draft.content, voice);

    const slug = await uniqueSlugFor(tenantSlug, draft.title);
    const googlePreview = buildGooglePreview({
      title: draft.title,
      metaDescription: draft.meta_description,
      slug,
      tenantDomain,
    });

    const { data, error } = await client
      .from("blog_posts")
      .insert({
        tenant_slug: tenantSlug,
        title: draft.title,
        slug,
        target_keyword: (keyword || groundingKeyword) || null,
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
        content_flags: contentFlags,
      })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "Insert failed" };

    return {
      postId: data.id,
      wordCount: finalWordCount,
      targetWordCount: meta.target_word_count,
      wordCountWarning,
      contentScore: score?.total ?? null,
      scoreWarning,
    };
  } catch (err) {
    const msg =
      err instanceof BlogGenerationError
        ? "AI generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { error: msg };
  }
}
