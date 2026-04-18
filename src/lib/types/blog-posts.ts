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

/** Mirrors `SubScores` in `src/lib/ai/score-blog.ts`. */
export interface BlogSubScores {
  alignment: { score: number; max: number };
  seo: { score: number; max: number };
  readability: { score: number; max: number };
  depth: { score: number; max: number };
  structure: { score: number; max: number };
  faq: { score: number; max: number };
  eeat: { score: number; max: number };
}

export interface BlogScoreIssue {
  subScore:
    | "alignment"
    | "seo"
    | "readability"
    | "depth"
    | "structure"
    | "faq"
    | "eeat";
  severity: "high" | "med" | "low";
  message: string;
  suggestedFix: string;
  affectedSection?: string;
}

export interface BlogGooglePreview {
  title_display: string;
  url_display: string;
  meta_display: string;
}

export interface BlogPostRecord {
  id: string;
  tenantSlug: string;
  title: string;
  slug: string | null;
  targetKeyword: string | null;
  secondaryKeywords: string[];
  metaDescription: string | null;
  outline: BlogPostOutlineItem[];
  content: string;
  /** TipTap JSON doc. Null on pre-Phase-D rows — editor lazy-migrates
   *  by parsing `content` markdown into TipTap state on first open. */
  contentJson: unknown | null;
  wordCount: number;
  status: BlogPostStatus;
  generatorModel: string | null;
  generationMeta: BlogGenerationMeta | null;
  /** 0-100 total; null for rows that predate scoring (Phase B). */
  contentScore: number | null;
  subScores: BlogSubScores | null;
  scoreIssues: BlogScoreIssue[];
  scoreWarning: boolean;
  /** JSON-LD FAQPage object or null. Populated later in Phase D; for now scored from content. */
  faqSchema: unknown | null;
  /** Cached Google preview {title_display, url_display, meta_display}. */
  googlePreview: BlogGooglePreview | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogPostVersionRecord {
  id: string;
  blogPostId: string;
  tenantSlug: string;
  versionNumber: number;
  contentJson: unknown | null;
  contentMarkdown: string;
  wordCount: number;
  contentScore: number | null;
  diffSummary: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type BlogPostFeedbackStatus = "pending" | "applied" | "rejected";

export interface BlogPostFeedbackRecord {
  id: string;
  blogPostId: string;
  tenantSlug: string;
  feedbackText: string | null;
  feedbackAudioPath: string | null;
  transcription: string | null;
  sourceVersionId: string | null;
  resultingVersionId: string | null;
  status: BlogPostFeedbackStatus;
  createdBy: string | null;
  createdAt: string;
  appliedAt: string | null;
}
