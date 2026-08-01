// Writer layer for synced ad structure/performance — platform-agnostic.
// Every sync client (Meta via Composio, TikTok direct) normalizes into the
// same NormalizedX shapes (src/lib/types/ads-platform.ts) before calling
// these, so this file never branches on platform.

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  NormalizedAd,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedCreative,
  NormalizedInsightRow,
} from "@/lib/types/ads-platform";

export async function upsertCampaigns(
  tenantSlug: string,
  adAccountId: string,
  campaigns: NormalizedCampaign[]
): Promise<Map<string, string>> {
  if (campaigns.length === 0) return new Map();
  const admin = createAdminClient();
  const rows = campaigns.map((c) => ({
    tenant_slug: tenantSlug,
    ad_account_id: adAccountId,
    external_id: c.externalId,
    name: c.name,
    objective: c.objective,
    status: c.status,
    effective_status: c.effectiveStatus,
    budget_mode: c.budgetMode,
    budget_amount: c.budgetAmount,
    bid_strategy: c.bidStrategy,
    start_time: c.startTime,
    end_time: c.endTime,
    raw: c.raw,
    synced_at: new Date().toISOString(),
  }));
  const { data, error } = await admin
    .from("ad_campaigns")
    .upsert(rows, { onConflict: "ad_account_id,external_id" })
    .select("id, external_id");
  if (error) throw new Error(`upsertCampaigns: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.external_id as string, r.id as string]));
}

export async function upsertAdSets(
  tenantSlug: string,
  campaignIdByExternalId: Map<string, string>,
  adSets: NormalizedAdSet[]
): Promise<Map<string, string>> {
  const rows = adSets
    .map((a) => {
      const campaignId = campaignIdByExternalId.get(a.campaignExternalId);
      if (!campaignId) return null;
      return {
        tenant_slug: tenantSlug,
        ad_campaign_id: campaignId,
        external_id: a.externalId,
        name: a.name,
        status: a.status,
        effective_status: a.effectiveStatus,
        budget_mode: a.budgetMode,
        budget_amount: a.budgetAmount,
        optimization_goal: a.optimizationGoal,
        billing_event: a.billingEvent,
        targeting: a.targeting,
        raw: a.raw,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return new Map();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_sets")
    .upsert(rows, { onConflict: "ad_campaign_id,external_id" })
    .select("id, external_id");
  if (error) throw new Error(`upsertAdSets: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.external_id as string, r.id as string]));
}

export async function upsertCreatives(
  tenantSlug: string,
  adAccountId: string,
  creatives: NormalizedCreative[]
): Promise<Map<string, string>> {
  if (creatives.length === 0) return new Map();
  const admin = createAdminClient();
  const rows = creatives.map((c) => ({
    tenant_slug: tenantSlug,
    ad_account_id: adAccountId,
    external_id: c.externalId,
    name: c.name,
    headline: c.headline,
    body: c.body,
    cta: c.cta,
    image_url: c.imageUrl,
    video_url: c.videoUrl,
    landing_url: c.landingUrl,
    raw: c.raw,
    synced_at: new Date().toISOString(),
  }));
  const { data, error } = await admin
    .from("ad_creatives")
    .upsert(rows, { onConflict: "ad_account_id,external_id" })
    .select("id, external_id");
  if (error) throw new Error(`upsertCreatives: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.external_id as string, r.id as string]));
}

export async function upsertAds(
  tenantSlug: string,
  adSetIdByExternalId: Map<string, string>,
  creativeIdByExternalId: Map<string, string>,
  ads: NormalizedAd[]
): Promise<void> {
  const rows = ads
    .map((a) => {
      const adSetId = adSetIdByExternalId.get(a.adSetExternalId);
      if (!adSetId) return null;
      return {
        tenant_slug: tenantSlug,
        ad_set_id: adSetId,
        external_id: a.externalId,
        name: a.name,
        status: a.status,
        effective_status: a.effectiveStatus,
        creative_id: a.creativeExternalId ? creativeIdByExternalId.get(a.creativeExternalId) ?? null : null,
        raw: a.raw,
        synced_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;

  const admin = createAdminClient();
  const { error } = await admin.from("ads").upsert(rows, { onConflict: "ad_set_id,external_id" });
  if (error) throw new Error(`upsertAds: ${error.message}`);
}

export async function upsertInsightRows(
  tenantSlug: string,
  adAccountId: string,
  rows: NormalizedInsightRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const admin = createAdminClient();
  const payload = rows.map((r) => ({
    tenant_slug: tenantSlug,
    ad_account_id: adAccountId,
    level: r.level,
    external_id: r.externalId,
    date: r.date,
    spend: r.spend,
    impressions: r.impressions,
    reach: r.reach,
    frequency: r.frequency,
    clicks: r.clicks,
    link_clicks: r.linkClicks,
    ctr: r.ctr,
    cpc: r.cpc,
    cpm: r.cpm,
    conversions: r.conversions,
    conversion_value: r.conversionValue,
    platform_roas: r.platformRoas,
    currency: r.currency,
    raw: r.raw,
  }));
  // Chunk — a full-account, multi-day, ad-level backfill can produce
  // thousands of rows; stay well under any single-request payload limit.
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await admin
      .from("ad_insights_daily")
      .upsert(payload.slice(i, i + CHUNK), { onConflict: "ad_account_id,level,external_id,date" });
    if (error) throw new Error(`upsertInsightRows: ${error.message}`);
  }
}
