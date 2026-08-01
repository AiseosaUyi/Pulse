// Shared types for the real ads platform (migration 094). Platform-agnostic
// so sync/query/UI code never has to branch on meta-vs-tiktok — each
// platform's client normalizes into these shapes.

export type AdPlatformKind = "meta" | "tiktok";

export interface AdAccountRecord {
  id: string;
  tenantSlug: string;
  platform: AdPlatformKind;
  externalAccountId: string;
  accountName: string | null;
  currency: string;
  timezone: string | null;
  status: "active" | "disabled" | "error";
  lastSyncedAt: string | null;
  lastInsightsSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  // Server-side conversion config (migration 096). The CAPI token itself is
  // never sent to the client — metaCapiConfigured is a boolean projection so
  // the UI can show "configured" without exposing even the encrypted value.
  metaPixelId: string | null;
  metaCapiConfigured: boolean;
  tiktokPixelCode: string | null;
}

export type AdObjectStatus = "active" | "paused" | "deleted" | "archived";

export interface AdCampaignRecord {
  id: string;
  tenantSlug: string;
  adAccountId: string;
  externalId: string;
  name: string;
  objective: string | null;
  status: AdObjectStatus;
  effectiveStatus: string | null;
  budgetMode: "daily" | "lifetime" | "adset_managed" | null;
  budgetAmount: number | null;
  bidStrategy: string | null;
  startTime: string | null;
  endTime: string | null;
  syncedAt: string;
}

export interface AdSetRecord {
  id: string;
  tenantSlug: string;
  adCampaignId: string;
  externalId: string;
  name: string;
  status: AdObjectStatus;
  effectiveStatus: string | null;
  budgetMode: "daily" | "lifetime" | null;
  budgetAmount: number | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  targeting: Record<string, unknown>;
  syncedAt: string;
}

export interface AdRecord {
  id: string;
  tenantSlug: string;
  adSetId: string;
  externalId: string;
  name: string;
  status: AdObjectStatus;
  effectiveStatus: string | null;
  creativeId: string | null;
  syncedAt: string;
}

export interface AdCreativeRecord {
  id: string;
  tenantSlug: string;
  adAccountId: string;
  externalId: string;
  name: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  landingUrl: string | null;
  syncedAt: string;
}

export type AdInsightsLevel = "campaign" | "adset" | "ad";

export interface AdInsightsDailyRecord {
  id: string;
  tenantSlug: string;
  adAccountId: string;
  level: AdInsightsLevel;
  externalId: string;
  date: string;
  spend: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  clicks: number;
  linkClicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number;
  conversionValue: number;
  platformRoas: number | null;
  currency: string;
}

/** Platform-normalized shape every sync client (Meta, TikTok) must produce
 *  before it's written to `ad_insights_daily` — keeps the writer/upsert
 *  logic identical across platforms. */
export interface NormalizedInsightRow {
  level: AdInsightsLevel;
  externalId: string;
  date: string;
  spend: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  clicks: number;
  linkClicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number;
  conversionValue: number;
  platformRoas: number | null;
  currency: string;
  raw: Record<string, unknown>;
}

export interface NormalizedCampaign {
  externalId: string;
  name: string;
  objective: string | null;
  status: AdObjectStatus;
  effectiveStatus: string | null;
  budgetMode: "daily" | "lifetime" | "adset_managed" | null;
  budgetAmount: number | null;
  bidStrategy: string | null;
  startTime: string | null;
  endTime: string | null;
  raw: Record<string, unknown>;
}

export interface NormalizedAdSet {
  externalId: string;
  campaignExternalId: string;
  name: string;
  status: AdObjectStatus;
  effectiveStatus: string | null;
  budgetMode: "daily" | "lifetime" | null;
  budgetAmount: number | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  targeting: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface NormalizedAd {
  externalId: string;
  adSetExternalId: string;
  name: string;
  status: AdObjectStatus;
  effectiveStatus: string | null;
  creativeExternalId: string | null;
  raw: Record<string, unknown>;
}

export interface NormalizedCreative {
  externalId: string;
  name: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  landingUrl: string | null;
  raw: Record<string, unknown>;
}

// ─── Budget rules ───────────────────────────────────────────────────

export type BudgetRuleMetric = "cpa" | "roas" | "ctr" | "frequency" | "spend" | "cpm";
export type BudgetRuleComparator = "gt" | "lt" | "gte" | "lte";
export type BudgetRuleAction = "pause" | "notify_only" | "increase_budget" | "decrease_budget";
export type BudgetRuleScope = "account" | "campaign" | "adset";

export interface AdBudgetRuleRecord {
  id: string;
  tenantSlug: string;
  adAccountId: string | null;
  name: string;
  scope: BudgetRuleScope;
  targetExternalId: string | null;
  metric: BudgetRuleMetric;
  comparator: BudgetRuleComparator;
  threshold: number;
  holdDays: number;
  action: BudgetRuleAction;
  actionAmountPct: number | null;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  createdAt: string;
}

export interface AdBudgetRuleRunRecord {
  id: string;
  ruleId: string;
  tenantSlug: string;
  targetExternalId: string;
  conditionMet: boolean;
  actionTaken: string | null;
  metricValue: number | null;
  notes: string | null;
  evaluatedAt: string;
}

// ─── Competitor ad intelligence ─────────────────────────────────────

export interface CompetitorAdRecord {
  id: string;
  tenantSlug: string;
  competitorId: string | null;
  platform: AdPlatformKind;
  externalAdId: string;
  pageOrAccountName: string | null;
  snapshotUrl: string | null;
  creativeBody: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  stillActive: boolean;
  platformsDelivered: string[];
  variantGroupKey: string | null;
}

// ─── Attribution ────────────────────────────────────────────────────

export interface AdCampaignRoas {
  campaignExternalId: string;
  campaignName: string | null;
  adAccountId: string;
  platform: AdPlatformKind;
  spend: number;
  platformReportedRevenue: number;
  platformReportedRoas: number | null;
  /** Revenue from Pulse's own `orders` table, matched by utm_campaign. */
  attributedRevenue: number;
  attributedOrders: number;
  /** attributedRevenue / spend — the "true" ROAS, computed against real
   *  orders rather than the platform's own (often inflated) reporting. */
  blendedRoas: number | null;
  currency: string;
}
