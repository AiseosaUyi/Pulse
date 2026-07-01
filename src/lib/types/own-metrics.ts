export type OwnMetricsPlatform = "instagram" | "tiktok" | "twitter" | "linkedin";
export type OwnMetricsSource = "csv" | "screenshot" | "manual" | "json_export" | "html_export";

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
  importBatchId: string | null;
}

export interface ImportSession {
  id: string;
  tenantSlug: string;
  platform: string;
  postCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  importedAt: string;
  label: string | null;
}
