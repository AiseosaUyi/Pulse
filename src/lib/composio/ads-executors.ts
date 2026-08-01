// Meta Ads via Composio's `metaads` toolkit. Tool slugs verified against
// Composio's live toolkit reference (docs.composio.dev/toolkits/metaads) —
// not guessed from naming convention. Two structural gaps in Composio's
// tool set, worked around below:
//   - No dedicated "list campaigns" tool exists. Campaigns are derived by
//     pulling ad sets (which carry `campaign_id`) and de-duping, then
//     fetching each campaign's own fields via the generic GET_OBJECT tool.
//   - No dedicated "pause an ad/ad set" tool exists at that granularity —
//     only campaign-level status via UPDATE_CAMPAIGN. Ad-set/ad-level
//     pause (used by the budget rules engine) goes through GET_OBJECT's
//     write path if Composio exposes one at runtime; until verified this
//     throws a clear NotImplementedError rather than silently no-op'ing.

import { createComposioClient } from "@/lib/composio/client";
import { type ResolvedConnection, userIdFor } from "@/lib/composio/resolve-alias";
import type {
  AdInsightsLevel,
  AdObjectStatus,
  NormalizedAd,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedCreative,
  NormalizedInsightRow,
} from "@/lib/types/ads-platform";

interface ExecuteResult {
  successful: boolean;
  data: unknown;
  error?: string | null;
}

async function exec(
  slug: string,
  conn: ResolvedConnection,
  args: Record<string, unknown>
): Promise<unknown> {
  const composio = createComposioClient();
  const result = (await composio.tools.execute(slug, {
    userId: userIdFor(conn),
    arguments: args,
  })) as ExecuteResult;
  if (!result.successful) {
    throw new Error(`Composio tool ${slug} failed: ${result.error ?? "unknown error"}`);
  }
  return result.data;
}

// ─── Ad accounts ────────────────────────────────────────────────────

export interface MetaAdAccount {
  id: string; // 'act_123456789'
  name: string | null;
  currency: string | null;
  timezoneName: string | null;
}

export async function listMetaAdAccounts(
  conn: ResolvedConnection
): Promise<MetaAdAccount[]> {
  const data = (await exec("METAADS_GET_AD_ACCOUNTS", conn, {
    fields: "id,name,currency,timezone_name",
  })) as { data?: Array<{ id: string; name?: string; currency?: string; timezone_name?: string }> };
  return (data.data ?? []).map((a) => ({
    id: a.id,
    name: a.name ?? null,
    currency: a.currency ?? null,
    timezoneName: a.timezone_name ?? null,
  }));
}

// ─── Structure sync ─────────────────────────────────────────────────

const STATUS_MAP: Record<string, AdObjectStatus> = {
  ACTIVE: "active",
  PAUSED: "paused",
  DELETED: "deleted",
  ARCHIVED: "archived",
};

function mapStatus(raw: string | undefined): AdObjectStatus {
  return STATUS_MAP[raw ?? ""] ?? "paused";
}

interface RawAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  targeting?: Record<string, unknown>;
}

/** Ad sets for an account, with `campaign_id` requested so the caller can
 *  derive the campaign list without a dedicated list-campaigns tool. */
export async function listMetaAdSets(
  conn: ResolvedConnection,
  adAccountId: string
): Promise<{ adSets: NormalizedAdSet[]; campaignIds: string[] }> {
  const data = (await exec("METAADS_READ_ADSETS", conn, {
    ad_account_id: adAccountId,
    fields: [
      "id",
      "name",
      "campaign_id",
      "status",
      "effective_status",
      "daily_budget",
      "lifetime_budget",
      "optimization_goal",
      "billing_event",
      "targeting",
    ],
    limit: 500,
  })) as { data?: RawAdSet[] };

  const rows = data.data ?? [];
  const adSets: NormalizedAdSet[] = rows.map((r) => ({
    externalId: r.id,
    campaignExternalId: r.campaign_id,
    name: r.name,
    status: mapStatus(r.status),
    effectiveStatus: r.effective_status ?? null,
    budgetMode: r.daily_budget ? "daily" : r.lifetime_budget ? "lifetime" : null,
    budgetAmount: r.daily_budget
      ? Number(r.daily_budget) / 100 // Meta returns budgets in minor units (cents)
      : r.lifetime_budget
        ? Number(r.lifetime_budget) / 100
        : null,
    optimizationGoal: r.optimization_goal ?? null,
    billingEvent: r.billing_event ?? null,
    targeting: r.targeting ?? {},
    raw: r as unknown as Record<string, unknown>,
  }));

  const campaignIds = [...new Set(adSets.map((a) => a.campaignExternalId))];
  return { adSets, campaignIds };
}

interface RawCampaignObject {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  start_time?: string;
  stop_time?: string;
}

/** Fetches full campaign fields by id via the generic object-fetch tool —
 *  the only way to get campaign-level data given Composio's tool gap. */
export async function getMetaCampaign(
  conn: ResolvedConnection,
  campaignId: string
): Promise<NormalizedCampaign> {
  const data = (await exec("METAADS_GET_OBJECT", conn, {
    object_id: campaignId,
    fields:
      "id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time",
  })) as RawCampaignObject;

  return {
    externalId: data.id,
    name: data.name,
    objective: data.objective ?? null,
    status: mapStatus(data.status),
    effectiveStatus: data.effective_status ?? null,
    budgetMode: data.daily_budget ? "daily" : data.lifetime_budget ? "lifetime" : "adset_managed",
    budgetAmount: data.daily_budget
      ? Number(data.daily_budget) / 100
      : data.lifetime_budget
        ? Number(data.lifetime_budget) / 100
        : null,
    bidStrategy: data.bid_strategy ?? null,
    startTime: data.start_time ?? null,
    endTime: data.stop_time ?? null,
    raw: data as unknown as Record<string, unknown>,
  };
}

export async function listMetaCampaigns(
  conn: ResolvedConnection,
  adAccountId: string
): Promise<{ campaigns: NormalizedCampaign[]; adSets: NormalizedAdSet[] }> {
  const { adSets, campaignIds } = await listMetaAdSets(conn, adAccountId);
  const campaigns = await Promise.all(campaignIds.map((id) => getMetaCampaign(conn, id)));
  return { campaigns, adSets };
}

interface RawAd {
  id: string;
  name: string;
  adset_id: string;
  status?: string;
  effective_status?: string;
  creative?: { id: string };
}

export async function listMetaAds(
  conn: ResolvedConnection,
  adAccountId: string
): Promise<NormalizedAd[]> {
  const data = (await exec("METAADS_LIST_ADS", conn, {
    ad_account_id: adAccountId,
    fields: "id,name,adset_id,status,effective_status,creative{id}",
  })) as { data?: RawAd[] };

  return (data.data ?? []).map((r) => ({
    externalId: r.id,
    adSetExternalId: r.adset_id,
    name: r.name,
    status: mapStatus(r.status),
    effectiveStatus: r.effective_status ?? null,
    creativeExternalId: r.creative?.id ?? null,
    raw: r as unknown as Record<string, unknown>,
  }));
}

interface RawCreative {
  id: string;
  name?: string;
  object_story_spec?: {
    link_data?: { message?: string; name?: string; call_to_action?: { type?: string }; link?: string; image_hash?: string };
    video_data?: { message?: string; call_to_action?: { type?: string }; video_id?: string; image_url?: string };
  };
  image_url?: string;
  video_id?: string;
}

export async function listMetaAdCreatives(
  conn: ResolvedConnection,
  adAccountId: string
): Promise<NormalizedCreative[]> {
  const data = (await exec("METAADS_LIST_AD_CREATIVES", conn, {
    ad_account_id: adAccountId,
    fields: "id,name,object_story_spec,image_url,video_id",
  })) as { data?: RawCreative[] };

  return (data.data ?? []).map((r) => {
    const link = r.object_story_spec?.link_data;
    const video = r.object_story_spec?.video_data;
    return {
      externalId: r.id,
      name: r.name ?? null,
      headline: link?.name ?? null,
      body: link?.message ?? video?.message ?? null,
      cta: link?.call_to_action?.type ?? video?.call_to_action?.type ?? null,
      imageUrl: r.image_url ?? video?.image_url ?? null,
      videoUrl: r.video_id ?? video?.video_id ?? null,
      landingUrl: link?.link ?? null,
      raw: r as unknown as Record<string, unknown>,
    };
  });
}

// ─── Insights ───────────────────────────────────────────────────────

const INSIGHT_FIELDS = [
  "campaign_id",
  "adset_id",
  "ad_id",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "purchase_roas",
];

interface RawInsightRow {
  date_start: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
}

const CONVERSION_ACTION_TYPES = new Set([
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
]);

function sumConversions(actions: RawInsightRow["actions"]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => CONVERSION_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + Number(a.value || 0), 0);
}

function sumConversionValue(actionValues: RawInsightRow["action_values"]): number {
  if (!actionValues) return 0;
  return actionValues
    .filter((a) => CONVERSION_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + Number(a.value || 0), 0);
}

function pickRoas(purchaseRoas: RawInsightRow["purchase_roas"]): number | null {
  const row = purchaseRoas?.find((r) => CONVERSION_ACTION_TYPES.has(r.action_type)) ?? purchaseRoas?.[0];
  return row ? Number(row.value) : null;
}

/** Pulls daily insight rows for one ad account at the given level, for the
 *  given date range (YYYY-MM-DD, inclusive). `time_increment: 1` is what
 *  makes Meta return one row per day rather than one aggregate row — this
 *  is what the sync cron needs for `ad_insights_daily`. */
export async function getMetaInsights(
  conn: ResolvedConnection,
  adAccountId: string,
  level: AdInsightsLevel,
  since: string,
  until: string,
  currency: string
): Promise<NormalizedInsightRow[]> {
  const data = (await exec("METAADS_GET_INSIGHTS", conn, {
    object_id: adAccountId,
    level,
    fields: INSIGHT_FIELDS,
    time_range: { since, until },
    time_increment: 1,
    limit: 500,
  })) as { data?: RawInsightRow[] };

  const idField = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id";

  return (data.data ?? []).map((r) => {
    const externalId = (r as unknown as Record<string, string>)[idField] ?? "";
    const clicks = Number(r.clicks ?? 0);
    const linkClicks = r.inline_link_clicks != null ? Number(r.inline_link_clicks) : null;
    return {
      level,
      externalId,
      date: r.date_start,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      reach: r.reach != null ? Number(r.reach) : null,
      frequency: r.frequency != null ? Number(r.frequency) : null,
      clicks,
      linkClicks,
      ctr: r.ctr != null ? Number(r.ctr) : null,
      cpc: r.cpc != null ? Number(r.cpc) : null,
      cpm: r.cpm != null ? Number(r.cpm) : null,
      conversions: sumConversions(r.actions),
      conversionValue: sumConversionValue(r.action_values),
      platformRoas: pickRoas(r.purchase_roas),
      currency,
      raw: r as unknown as Record<string, unknown>,
    };
  });
}

// ─── Write path (budget rules engine) ──────────────────────────────

export class MetaAdsNotSupportedError extends Error {
  constructor(action: string) {
    super(
      `${action} has no dedicated Composio tool for metaads at ad-set/ad granularity. ` +
        `Only campaign-level status changes are supported via METAADS_UPDATE_CAMPAIGN. ` +
        `Verify against composio.tools.get('metaads') before relying on ad-set/ad-level automation.`
    );
    this.name = "MetaAdsNotSupportedError";
  }
}

export async function pauseMetaCampaign(
  conn: ResolvedConnection,
  campaignId: string
): Promise<void> {
  await exec("METAADS_UPDATE_CAMPAIGN", conn, {
    campaign_id: campaignId,
    status: "PAUSED",
  });
}

export async function updateMetaCampaignBudget(
  conn: ResolvedConnection,
  campaignId: string,
  budgetMode: "daily" | "lifetime",
  newBudgetMinorUnits: number
): Promise<void> {
  await exec("METAADS_UPDATE_CAMPAIGN", conn, {
    campaign_id: campaignId,
    ...(budgetMode === "daily"
      ? { daily_budget: newBudgetMinorUnits }
      : { lifetime_budget: newBudgetMinorUnits }),
  });
}

// ─── Profile (used by confirmComposioConnection) ───────────────────

export async function getMetaAdsBusinessProfile(
  conn: ResolvedConnection
): Promise<{ label: string | null }> {
  const accounts = await listMetaAdAccounts(conn);
  const first = accounts[0];
  return { label: first ? first.name ?? first.id : null };
}
