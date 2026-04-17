export type TrendPlatform = "instagram" | "tiktok" | "twitter";
export type TrendSource = "creative_center" | "hashtag_scout" | "manual";
export type TrendApplicability = "high" | "medium" | "low" | "n/a";

export interface TrendMetrics {
  views?: number;
  likes?: number;
  engagement_rate?: number;
  trending_rank?: number;
  region?: string;
}

export interface TrendAnalysis {
  why_viral: string;
  format: string;
  applicability: TrendApplicability;
  suggested_adaptation: string;
}

export interface TrendScout {
  id: string;
  tenantSlug: string;
  platform: TrendPlatform;
  source: TrendSource;
  hashtag: string | null;
  externalUrl: string | null;
  title: string | null;
  summary: string;
  metrics: TrendMetrics;
  aiAnalysis: TrendAnalysis | null;
  applicability: TrendApplicability | null;
  dismissedAt: string | null;
  dismissedReason: string | null;
  capturedAt: string;
  createdAt: string;
}
