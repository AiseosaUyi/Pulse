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
  createdAt: string;
  updatedAt: string;
}
