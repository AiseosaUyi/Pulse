import { createClient } from "@/lib/supabase/server";
import type {
  BlogGenerationMeta,
  BlogGooglePreview,
  BlogImageRef,
  BlogPostRecord,
  BlogPostStatus,
  BlogPostOutlineItem,
  BlogScoreIssue,
  BlogSubScores,
} from "@/lib/types/blog-posts";

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
  google_preview: BlogGooglePreview | null;
  created_at: string;
  updated_at: string;
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
    googlePreview: row.google_preview ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
