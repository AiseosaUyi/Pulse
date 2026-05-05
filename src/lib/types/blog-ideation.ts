// Pure types + labels for blog ideation. No server imports — safe
// to import from client components. The AI generator lives in
// src/lib/ai/blog-ideate.ts and re-exports these for server callers.

export const BLOG_TYPES = [
  "educational",
  "tips",
  "engagement",
  "thought_leadership",
  "listicle",
  "case_study",
  "comparison",
  "how_to",
  "feature_announcement",
] as const;
export type BlogType = (typeof BLOG_TYPES)[number];

export const BLOG_TYPE_LABELS: Record<BlogType, string> = {
  educational: "Educational",
  tips: "Tips & best practices",
  engagement: "Engagement / opinion",
  thought_leadership: "Thought leadership",
  listicle: "Listicle",
  case_study: "Case study",
  comparison: "Comparison",
  how_to: "How-to guide",
  feature_announcement: "Feature announcement",
};

export const BLOG_TYPE_DESCRIPTIONS: Record<BlogType, string> = {
  educational:
    "Teach the audience something useful in your domain. Reader leaves smarter.",
  tips: "Practical, actionable tips a reader can apply today.",
  engagement:
    "Opinion / hot take / industry commentary designed to spark conversation.",
  thought_leadership:
    "Bigger-picture argument or framework that positions us as a category authority.",
  listicle: "Numbered list — scannable, share-friendly, great for SEO.",
  case_study: "A specific story: customer or internal — what we did + the result.",
  comparison: "Compare options / approaches / tools so the reader can decide.",
  how_to: "Step-by-step guide to accomplish a concrete outcome.",
  feature_announcement:
    "Introduce a new product feature, what it does, who benefits.",
};

export type FeatureAudience = "creators" | "users" | "both";

export interface FeatureMeta {
  name: string;
  about: string;
  audience: FeatureAudience;
  benefits: string;
}

export interface GeneratedBlogIdea {
  title: string;
  premise: string;
  target_keyword: string;
  secondary_keywords: string[];
  angle: string;
  trending_signal: string | null;
}

export interface GeneratedIdeaRow extends GeneratedBlogIdea {
  id: string;
  batchId: string;
  blogType: BlogType;
}
