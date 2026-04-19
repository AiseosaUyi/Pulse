export interface WebAnalyticsDaily {
  id: string;
  tenantSlug: string;
  source: "ga4" | "manual";
  pagePath: string;
  date: string;
  pageviews: number;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number;
  conversions: number;
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Ga4Config {
  property_id: string;
  client_email: string;
  /** Hint for the UI; full service-account JSON lives in secret_token. */
  project_id?: string;
}

export interface AnalyticsTotals {
  pageviews: number;
  sessions: number;
  users: number;
  avgEngagementSec: number;
  conversions: number;
  /** Top pages by pageviews in this window. */
  topPages: Array<{ path: string; pageviews: number; conversions: number }>;
}
