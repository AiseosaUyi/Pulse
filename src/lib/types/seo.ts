// ─── Core ─────────────────────────────────────────────────────

export interface SEOMetric {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down" | "stable";
}

export type KeywordDifficulty = "easy" | "medium" | "hard";

export interface KeywordRanking {
  id: string;
  tenantSlug: string;
  keyword: string;
  url: string | null;
  position: number | null;
  previousPosition: number | null;
  volume: number;
  difficulty: KeywordDifficulty;
  lastChecked: string | null;
  notes: string | null;
  createdAt: string;
}

export const KEYWORD_DIFFICULTY_LABELS: Record<KeywordDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

// ─── Keyword Research ─────────────────────────────────────────

export type SearchIntent = "informational" | "transactional" | "navigational" | "commercial";

export interface KeywordIdea {
  id: string;
  keyword: string;
  volume: number;
  difficulty: "easy" | "medium" | "hard";
  cpc: number;
  intent: SearchIntent;
  trend: "rising" | "stable" | "declining";
  parentTopic: string;
  isLongTail: boolean;
  serpFeatures: string[];
  source: "ai_discovered" | "competitor" | "manual";
}

export interface KeywordGroup {
  id: string;
  name: string;
  keywords: KeywordIdea[];
  avgVolume: number;
  avgDifficulty: string;
  dominantIntent: SearchIntent;
}

// ─── Topical Map / Content Clusters ───────────────────────────

export interface TopicalCluster {
  id: string;
  pillarTopic: string;
  pillarUrl: string | null;
  pillarStatus: "published" | "draft" | "planned" | "gap";
  supportingArticles: SupportingArticle[];
  totalVolume: number;
  coverageScore: number;
  internalLinks: InternalLink[];
}

export interface SupportingArticle {
  id: string;
  title: string;
  slug: string | null;
  status: "published" | "draft" | "planned" | "gap";
  targetKeyword: string;
  volume: number;
  position: number | null;
  linkedToPillar: boolean;
  contentScore: number | null;
}

export interface InternalLink {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  targetUrl: string;
  targetTitle: string;
  anchorText: string;
  status: "active" | "suggested" | "broken";
  linkEquity: "high" | "medium" | "low";
}

// ─── SEO Blog Posts ───────────────────────────────────────────

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  metaDescription: string;
  status: "generated" | "editing" | "review" | "published";
  contentScore: number;
  wordCount: number;
  headingStructure: HeadingNode[];
  faqItems: FAQItem[];
  schemaMarkup: "article" | "faq" | "howto" | "event";
  createdAt: string;
  clusterId: string | null;
}

export interface HeadingNode {
  level: "h1" | "h2" | "h3";
  text: string;
  keywordPresent: boolean;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface ContentScoreBreakdown {
  overall: number;
  titleOptimization: number;
  keywordDensity: number;
  headingStructure: number;
  metaDescription: number;
  readability: number;
  internalLinks: number;
  imageAltTags: number;
  contentLength: number;
  faqPresence: number;
}

// ─── Programmatic SEO ─────────────────────────────────────────

export interface ProgrammaticTemplate {
  id: string;
  name: string;
  pattern: string;
  variables: TemplateVariable[];
  generatedPages: ProgrammaticPage[];
  totalPages: number;
  indexedPages: number;
  avgPosition: number | null;
}

export interface TemplateVariable {
  name: string;
  values: string[];
}

export interface ProgrammaticPage {
  id: string;
  title: string;
  slug: string;
  variables: Record<string, string>;
  status: "generated" | "indexed" | "ranking" | "not_indexed";
  position: number | null;
  impressions: number;
  clicks: number;
}

// ─── SERP Analysis ────────────────────────────────────────────

export interface SERPResult {
  position: number;
  url: string;
  title: string;
  domain: string;
  domainAuthority: number;
  wordCount: number;
  headings: string[];
  hasSchema: boolean;
  hasFAQ: boolean;
  hasVideo: boolean;
  backlinks: number;
  contentAge: string;
}

export interface SERPAnalysis {
  id: string;
  keyword: string;
  volume: number;
  analyzedAt: string;
  results: SERPResult[];
  contentGaps: string[];
  avgWordCount: number;
  avgDomainAuthority: number;
  recommendedWordCount: number;
  recommendedHeadings: string[];
  difficulty: "easy" | "medium" | "hard";
  ourPosition: number | null;
  ourUrl: string | null;
}
