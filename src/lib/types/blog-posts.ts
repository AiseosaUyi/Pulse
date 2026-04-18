export type BlogPostStatus =
  | "draft"
  | "editing"
  | "review"
  | "published"
  | "archived";

export interface BlogPostOutlineItem {
  heading: string;
  bullets: string[];
}

/**
 * Shape written to `blog_posts.generation_meta` by the generator.
 * Mirrors `GenerationMeta` in `src/lib/ai/generate-blog-post.ts` — keep
 * in sync. Nullable on rows that predate migration 022.
 */
export interface BlogGenerationMeta {
  passes: Array<{
    pass: number;
    kind: "generate" | "expand" | "refine";
    word_count: number;
    cost_usd: number;
    duration_ms: number;
  }>;
  target_word_count: number;
  final_word_count: number;
  stopped_reason:
    | "ok"
    | "within_tolerance_initial"
    | "expanded_to_tolerance"
    | "max_passes_reached"
    | "error";
  total_cost_usd: number;
}

export interface BlogPostRecord {
  id: string;
  tenantSlug: string;
  title: string;
  targetKeyword: string | null;
  secondaryKeywords: string[];
  metaDescription: string | null;
  outline: BlogPostOutlineItem[];
  content: string;
  wordCount: number;
  status: BlogPostStatus;
  generatorModel: string | null;
  generationMeta: BlogGenerationMeta | null;
  createdAt: string;
  updatedAt: string;
}
