// ─── Intelligence Feed Types ─────────────────────────────────

export interface Competitor {
  id: string;
  tenantId: string;
  name: string;
  website: string;
  type: "direct" | "aspirational" | "adjacent";
  platforms: CompetitorPlatform[];
  strengths: string[];
  weaknesses: string[];
  threatLevel: "high" | "medium" | "low";
  addedAt: string;
}

export interface CompetitorPlatform {
  platform: "instagram" | "tiktok" | "twitter" | "linkedin" | "blog";
  handle: string;
  followers: number;
  engagementRate: string;
  lastChecked: string;
}

// ─── Intel Cards ─────────────────────────────────────────────

export interface IntelCard {
  id: string;
  tenantId: string;
  competitorId: string;
  competitorName: string;
  competitorType: "direct" | "aspirational" | "adjacent";
  platform: "instagram" | "tiktok" | "twitter" | "linkedin" | "blog";
  contentType: "reel" | "post" | "story" | "blog" | "video" | "thread";
  summary: string;
  postUrl?: string;
  metrics: {
    views?: number;
    likes?: number;
    engagement: number;
    engagementRate: number;
    shares?: number;
    comments?: number;
    vsAverage: number | null;
  };
  aiRecommendation: {
    impact: "high" | "medium" | "low";
    urgency: "urgent" | "opportunity" | "fyi";
    analysis: string;
    action: string;
    contentBriefReady: boolean;
  } | null;
  detectedAt: string;
  source: "api" | "manual";
}

// ─── Content Briefs ──────────────────────────────────────────

export type ContentBriefStatus = "draft" | "approved" | "published" | "dismissed";

export interface ContentBrief {
  id: string;
  tenantId: string;
  triggeredBy: string | null;
  triggeredByType: "intel_card" | "manual";
  platform: string;
  contentType: string;
  title: string;
  outline: string[];
  draftContent: string;
  seoKeywords?: string[];
  status: ContentBriefStatus;
  dismissedAt: string | null;
  dismissedReason: string | null;
  generatorModel: string | null;
  generatedAt: string;
  // Optional join: filled when list query embeds !triggered_by
  competitorName?: string;
  competitorPlatform?: string;
}

// ─── Morning Briefing ────────────────────────────────────────

export interface MorningBriefItem {
  summary: string;
  intelCardId: string;
  impact: "high" | "medium" | "low";
}

// ─── Weekly Digest ───────────────────────────────────────────

export interface WeeklyDigest {
  tenantId: string;
  weekOf: string;
  topCompetitorMoves: IntelCard[];
  winningFormats: { format: string; evidence: string; multiplier: number }[];
  recommendedActions: { priority: number; action: string; deadline?: string }[];
  strategicBrief: string;
}
