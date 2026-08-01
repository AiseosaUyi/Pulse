// TikTok Marketing API (Business API v1.3) — direct integration, no
// Composio toolkit exists for TikTok ads management (confirmed: Composio
// covers Meta/Google/LinkedIn ads, not TikTok). Distinct app/OAuth surface
// from TikTok's consumer Login Kit (open.tiktokapis.com) used for social
// publishing — do not conflate the two.
//
// Two things flagged unverified during research, load-bearing enough to
// call out here rather than bury in a comment: (1) whether the Marketing
// API access token is short-lived-with-refresh or effectively long-lived
// — this client stores + attempts to use a refresh token defensively so it
// behaves correctly either way, but `isTokenExpired` should be re-verified
// against a live sandbox app before this goes to production. (2) the exact
// SHA-256 hashing requirement on Events API user-data fields is assumed
// (universal in every third-party integration doc, standard industry
// practice, matches Meta CAPI) but not confirmed verbatim against TikTok's
// raw API reference.

const TT_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const TT_AUTH_URL = "https://business-api.tiktok.com/portal/auth";

export function isTikTokAdsConfigured(): boolean {
  return !!(process.env.TIKTOK_ADS_APP_ID && process.env.TIKTOK_ADS_APP_SECRET);
}

function callbackUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/integrations/tiktok-ads/callback`;
}

export class TikTokAdsError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
    this.name = "TikTokAdsError";
  }
}

interface TikTokEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function ttFetch<T>(
  path: string,
  opts: { method?: "GET" | "POST"; accessToken?: string; body?: Record<string, unknown>; query?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${TT_BASE}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.accessToken ? { "Access-Token": opts.accessToken } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json()) as TikTokEnvelope<T>;
  if (!res.ok || json.code !== 0) {
    throw new TikTokAdsError(json.message ?? `TikTok API error (HTTP ${res.status})`, json.code);
  }
  return json.data;
}

// ─── Auth ───────────────────────────────────────────────────────────

export function buildTikTokAdsAuthUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: process.env.TIKTOK_ADS_APP_ID!,
    state,
    redirect_uri: callbackUrl(),
  });
  return `${TT_AUTH_URL}?${params}`;
}

export interface TikTokAdsTokens {
  accessToken: string;
  advertiserIds: string[];
  /** Refresh token, if TikTok's response includes one — not guaranteed
   *  present on every app config, see file header caveat. */
  refreshToken?: string;
}

export async function exchangeTikTokAdsCode(authCode: string): Promise<TikTokAdsTokens> {
  const data = await ttFetch<{
    access_token: string;
    advertiser_ids?: string[];
    refresh_token?: string;
  }>("/oauth2/access_token/", {
    method: "POST",
    body: {
      app_id: process.env.TIKTOK_ADS_APP_ID,
      secret: process.env.TIKTOK_ADS_APP_SECRET,
      auth_code: authCode,
    },
  });
  return {
    accessToken: data.access_token,
    advertiserIds: data.advertiser_ids ?? [],
    refreshToken: data.refresh_token,
  };
}

export interface TikTokAdvertiser {
  advertiserId: string;
  advertiserName: string | null;
  currency: string | null;
  timezone: string | null;
}

export async function listTikTokAdvertisers(accessToken: string): Promise<TikTokAdvertiser[]> {
  const data = await ttFetch<{ list?: Array<{ advertiser_id: string; advertiser_name?: string; currency?: string; timezone?: string }> }>(
    "/oauth2/advertiser/get/",
    {
      accessToken,
      query: {
        app_id: process.env.TIKTOK_ADS_APP_ID!,
        secret: process.env.TIKTOK_ADS_APP_SECRET!,
      },
    }
  );
  return (data.list ?? []).map((a) => ({
    advertiserId: a.advertiser_id,
    advertiserName: a.advertiser_name ?? null,
    currency: a.currency ?? null,
    timezone: a.timezone ?? null,
  }));
}

// ─── Structure sync ─────────────────────────────────────────────────

import type {
  AdInsightsLevel,
  AdObjectStatus,
  NormalizedAd,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedCreative,
  NormalizedInsightRow,
} from "@/lib/types/ads-platform";

// TikTok's `operation_status` enum maps cleanly onto ours except it uses
// ENABLE/DISABLE rather than ACTIVE/PAUSED.
function mapTikTokStatus(raw: string | undefined): AdObjectStatus {
  switch (raw) {
    case "ENABLE":
      return "active";
    case "DISABLE":
      return "paused";
    case "DELETE":
      return "deleted";
    default:
      return "paused";
  }
}

interface RawTikTokCampaign {
  campaign_id: string;
  campaign_name: string;
  objective_type?: string;
  operation_status?: string;
  budget?: number;
  budget_mode?: string;
  bid_type?: string;
  create_time?: string;
}

export async function listTikTokCampaigns(
  accessToken: string,
  advertiserId: string
): Promise<NormalizedCampaign[]> {
  const data = await ttFetch<{ list?: RawTikTokCampaign[] }>("/campaign/get/", {
    accessToken,
    query: {
      advertiser_id: advertiserId,
      page_size: "1000",
      fields: JSON.stringify([
        "campaign_id",
        "campaign_name",
        "objective_type",
        "operation_status",
        "budget",
        "budget_mode",
        "bid_type",
        "create_time",
      ]),
    },
  });
  return (data.list ?? []).map((c) => ({
    externalId: c.campaign_id,
    name: c.campaign_name,
    objective: c.objective_type ?? null,
    status: mapTikTokStatus(c.operation_status),
    effectiveStatus: c.operation_status ?? null,
    budgetMode: c.budget_mode === "BUDGET_MODE_TOTAL" ? "lifetime" : c.budget != null ? "daily" : "adset_managed",
    budgetAmount: c.budget ?? null,
    bidStrategy: c.bid_type ?? null,
    startTime: c.create_time ?? null,
    endTime: null,
    raw: c as unknown as Record<string, unknown>,
  }));
}

interface RawTikTokAdGroup {
  adgroup_id: string;
  adgroup_name: string;
  campaign_id: string;
  operation_status?: string;
  budget?: number;
  budget_mode?: string;
  optimization_goal?: string;
  billing_event?: string;
}

export async function listTikTokAdGroups(
  accessToken: string,
  advertiserId: string
): Promise<NormalizedAdSet[]> {
  const data = await ttFetch<{ list?: RawTikTokAdGroup[] }>("/adgroup/get/", {
    accessToken,
    query: {
      advertiser_id: advertiserId,
      page_size: "1000",
      fields: JSON.stringify([
        "adgroup_id",
        "adgroup_name",
        "campaign_id",
        "operation_status",
        "budget",
        "budget_mode",
        "optimization_goal",
        "billing_event",
      ]),
    },
  });
  return (data.list ?? []).map((a) => ({
    externalId: a.adgroup_id,
    campaignExternalId: a.campaign_id,
    name: a.adgroup_name,
    status: mapTikTokStatus(a.operation_status),
    effectiveStatus: a.operation_status ?? null,
    budgetMode: a.budget_mode === "BUDGET_MODE_DAY" ? "daily" : a.budget != null ? "lifetime" : null,
    budgetAmount: a.budget ?? null,
    optimizationGoal: a.optimization_goal ?? null,
    billingEvent: a.billing_event ?? null,
    targeting: {},
    raw: a as unknown as Record<string, unknown>,
  }));
}

interface RawTikTokAd {
  ad_id: string;
  ad_name: string;
  adgroup_id: string;
  operation_status?: string;
  ad_text?: string;
  call_to_action?: string;
  landing_page_url?: string;
  image_ids?: string[];
  video_id?: string;
}

export async function listTikTokAds(
  accessToken: string,
  advertiserId: string
): Promise<{ ads: NormalizedAd[]; creatives: NormalizedCreative[] }> {
  const data = await ttFetch<{ list?: RawTikTokAd[] }>("/ad/get/", {
    accessToken,
    query: {
      advertiser_id: advertiserId,
      page_size: "1000",
      fields: JSON.stringify([
        "ad_id",
        "ad_name",
        "adgroup_id",
        "operation_status",
        "ad_text",
        "call_to_action",
        "landing_page_url",
        "image_ids",
        "video_id",
      ]),
    },
  });
  const rows = data.list ?? [];

  // TikTok carries creative fields directly on the ad object rather than a
  // separate creative entity — synthesize a 1:1 creative row per ad so the
  // rest of the platform (which models Meta's separate-creative shape)
  // doesn't need a TikTok-specific code path downstream.
  const ads: NormalizedAd[] = rows.map((r) => ({
    externalId: r.ad_id,
    adSetExternalId: r.adgroup_id,
    name: r.ad_name,
    status: mapTikTokStatus(r.operation_status),
    effectiveStatus: r.operation_status ?? null,
    creativeExternalId: `${r.ad_id}-creative`,
    raw: r as unknown as Record<string, unknown>,
  }));
  const creatives: NormalizedCreative[] = rows.map((r) => ({
    externalId: `${r.ad_id}-creative`,
    name: r.ad_name,
    headline: null,
    body: r.ad_text ?? null,
    cta: r.call_to_action ?? null,
    imageUrl: r.image_ids?.[0] ?? null,
    videoUrl: r.video_id ?? null,
    landingUrl: r.landing_page_url ?? null,
    raw: r as unknown as Record<string, unknown>,
  }));
  return { ads, creatives };
}

// ─── Insights ───────────────────────────────────────────────────────

const LEVEL_TO_DATA_LEVEL: Record<AdInsightsLevel, string> = {
  campaign: "AUCTION_CAMPAIGN",
  adset: "AUCTION_ADGROUP",
  ad: "AUCTION_AD",
};
const LEVEL_TO_DIMENSION: Record<AdInsightsLevel, string> = {
  campaign: "campaign_id",
  adset: "adgroup_id",
  ad: "ad_id",
};

interface RawTikTokReportRow {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
}

/** `since`/`until` are YYYY-MM-DD, inclusive — mirrors the Meta client's
 *  signature so the sync cron can call both uniformly. */
export async function getTikTokInsights(
  accessToken: string,
  advertiserId: string,
  level: AdInsightsLevel,
  since: string,
  until: string,
  currency: string
): Promise<NormalizedInsightRow[]> {
  const dimensionField = LEVEL_TO_DIMENSION[level];
  const data = await ttFetch<{ list?: RawTikTokReportRow[] }>("/report/integrated/get/", {
    accessToken,
    query: {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: LEVEL_TO_DATA_LEVEL[level],
      dimensions: JSON.stringify([dimensionField, "stat_time_day"]),
      metrics: JSON.stringify([
        "spend",
        "impressions",
        "reach",
        "frequency",
        "clicks",
        "ctr",
        "cpc",
        "cpm",
        "conversion",
        "total_complete_payment_rate",
        "cost_per_conversion",
      ]),
      start_date: since,
      end_date: until,
      page_size: "1000",
    },
  });

  return (data.list ?? []).map((r) => {
    const spend = Number(r.metrics.spend ?? 0);
    const conversions = Number(r.metrics.conversion ?? 0);
    // TikTok's integrated report doesn't return a value-based ROAS metric
    // in the BASIC set — conversion *value* requires the ADVANCED report
    // type with a connected catalog/pixel goal. Left null here; the
    // blended-ROAS join (src/lib/attribution/ads.ts) is what actually
    // matters for ROAS accuracy regardless.
    return {
      level,
      externalId: r.dimensions[dimensionField] ?? "",
      date: r.dimensions.stat_time_day?.slice(0, 10) ?? since,
      spend,
      impressions: Number(r.metrics.impressions ?? 0),
      reach: r.metrics.reach != null ? Number(r.metrics.reach) : null,
      frequency: r.metrics.frequency != null ? Number(r.metrics.frequency) : null,
      clicks: Number(r.metrics.clicks ?? 0),
      linkClicks: null,
      ctr: r.metrics.ctr != null ? Number(r.metrics.ctr) : null,
      cpc: r.metrics.cpc != null ? Number(r.metrics.cpc) : null,
      cpm: r.metrics.cpm != null ? Number(r.metrics.cpm) : null,
      conversions,
      conversionValue: 0,
      platformRoas: null,
      currency,
      raw: r as unknown as Record<string, unknown>,
    };
  });
}

// ─── Write path (budget rules engine) ──────────────────────────────

export async function pauseTikTokCampaign(accessToken: string, advertiserId: string, campaignId: string): Promise<void> {
  await ttFetch("/campaign/update/", {
    method: "POST",
    accessToken,
    body: {
      advertiser_id: advertiserId,
      campaign_id: campaignId,
      operation_status: "DISABLE",
    },
  });
}

export async function updateTikTokAdGroupBudget(
  accessToken: string,
  advertiserId: string,
  adGroupId: string,
  newBudget: number
): Promise<void> {
  await ttFetch("/adgroup/update/", {
    method: "POST",
    accessToken,
    body: {
      advertiser_id: advertiserId,
      adgroup_id: adGroupId,
      budget: newBudget,
    },
  });
}

// ─── Events API (server-side conversions) ──────────────────────────

export interface TikTokEventPayload {
  pixelCode: string;
  event: string;
  eventId: string;
  eventTime: number; // unix seconds
  email?: string; // pre-hashed, SHA-256 hex
  phone?: string; // pre-hashed, SHA-256 hex
  externalId?: string;
  ip?: string;
  userAgent?: string;
  ttclid?: string;
  value?: number;
  currency?: string;
  contentIds?: string[];
}

export async function pushTikTokEvent(accessToken: string, payload: TikTokEventPayload): Promise<void> {
  await ttFetch("/event/track/", {
    method: "POST",
    accessToken,
    body: {
      event_source: "web",
      event_source_id: payload.pixelCode,
      data: [
        {
          event: payload.event,
          event_time: payload.eventTime,
          event_id: payload.eventId,
          user: {
            email: payload.email,
            phone: payload.phone,
            external_id: payload.externalId,
            ip: payload.ip,
            user_agent: payload.userAgent,
            ttclid: payload.ttclid,
          },
          properties: {
            value: payload.value,
            currency: payload.currency,
            content_ids: payload.contentIds,
          },
        },
      ],
    },
  });
}
