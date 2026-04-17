export type OwnMetricsPlatform = "instagram" | "tiktok" | "twitter" | "linkedin";
export type OwnMetricsSource = "csv" | "screenshot" | "manual";

export interface OwnMetricsPayload {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
  impressions?: number;
  engagement_rate?: number;
}

export interface OwnPostMetric {
  id: string;
  tenantSlug: string;
  postId: string | null;
  platform: OwnMetricsPlatform;
  externalUrl: string | null;
  title: string | null;
  caption: string | null;
  capturedAt: string;
  source: OwnMetricsSource;
  metrics: OwnMetricsPayload;
  createdAt: string;
}
