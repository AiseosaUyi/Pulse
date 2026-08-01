// Real (blended) ROAS — the actual differentiator over what Meta/TikTok
// report themselves. Platform-reported ROAS is a pixel/API-side estimate
// that's frequently inflated (see PULSE-ADS-SPEC research: 20-60%
// divergence from real revenue, worse post-iOS-ATT). This joins synced ad
// spend against Pulse's own `orders` table — the same attribution spine
// `src/lib/attribution/links.ts` already uses for organic content — so
// ROAS here is computed from money that actually landed, not a platform's
// self-report.
//
// The join key is `orders.utm_campaign`. Ad platforms have no shared ID
// with that column, so there's an honesty gap: we can GUESS a match (slug
// of the campaign name) but can't GUARANTEE one without the advertiser
// either running Pulse-generated tracking links on their ad destination
// URLs or manually confirming the mapping. Both are surfaced via
// `matchConfidence` rather than silently presenting a guess as fact.

import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/blog/slug";
import type { AdCampaignRoas, AdPlatformKind } from "@/lib/types/ads-platform";

export type MatchConfidence = "confirmed" | "guessed" | "unmatched";

export interface AdCampaignRoasRow extends AdCampaignRoas {
  matchConfidence: MatchConfidence;
  matchedUtmCampaign: string | null;
}

function round(n: number, places = 2): number {
  return Number(n.toFixed(places));
}

export async function getAdCampaignRoas(
  tenantSlug: string,
  days = 30
): Promise<AdCampaignRoasRow[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [campaignsRes, insightsRes, ordersRes] = await Promise.all([
    admin
      .from("ad_campaigns")
      .select("external_id, name, utm_campaign_override, utm_mapping_confirmed, ad_account_id, ad_accounts!inner(id, platform, currency)")
      .eq("tenant_slug", tenantSlug),
    admin
      .from("ad_insights_daily")
      .select("ad_account_id, external_id, spend, conversion_value, platform_roas, currency")
      .eq("tenant_slug", tenantSlug)
      .eq("level", "campaign")
      .gte("date", since),
    admin
      .from("orders")
      .select("amount, currency, utm_campaign")
      .eq("tenant_slug", tenantSlug)
      .gte("created_at", since),
  ]);

  const rawCampaigns = (campaignsRes.data ?? []) as unknown as Array<{
    external_id: string;
    name: string;
    utm_campaign_override: string | null;
    utm_mapping_confirmed: boolean;
    ad_account_id: string;
    ad_accounts: { id: string; platform: AdPlatformKind; currency: string } | { id: string; platform: AdPlatformKind; currency: string }[];
  }>;
  const campaigns = rawCampaigns
    .map((c) => ({
      ...c,
      ad_accounts: Array.isArray(c.ad_accounts) ? c.ad_accounts[0] : c.ad_accounts,
    }))
    .filter((c): c is typeof c & { ad_accounts: { id: string; platform: AdPlatformKind; currency: string } } => !!c.ad_accounts);

  // Aggregate insights per (ad_account_id, campaign external_id).
  const spendByCampaign = new Map<string, { spend: number; platformRevenue: number; roasSamples: number[] }>();
  for (const row of insightsRes.data ?? []) {
    const key = `${row.ad_account_id}:${row.external_id}`;
    const prev = spendByCampaign.get(key) ?? { spend: 0, platformRevenue: 0, roasSamples: [] };
    prev.spend += Number(row.spend ?? 0);
    prev.platformRevenue += Number(row.conversion_value ?? 0);
    if (row.platform_roas != null) prev.roasSamples.push(Number(row.platform_roas));
    spendByCampaign.set(key, prev);
  }

  // Orders grouped by lowercased utm_campaign for case-insensitive match.
  const revenueByUtm = new Map<string, { revenue: number; orders: number; currency: string }>();
  for (const o of ordersRes.data ?? []) {
    if (!o.utm_campaign) continue;
    const key = o.utm_campaign.toLowerCase();
    const prev = revenueByUtm.get(key) ?? { revenue: 0, orders: 0, currency: o.currency ?? "NGN" };
    prev.revenue += Number(o.amount ?? 0);
    prev.orders += 1;
    revenueByUtm.set(key, prev);
  }

  const results: AdCampaignRoasRow[] = campaigns.map((c) => {
    const perf = spendByCampaign.get(`${c.ad_account_id}:${c.external_id}`) ?? { spend: 0, platformRevenue: 0, roasSamples: [] };

    let matchConfidence: MatchConfidence = "unmatched";
    let matchedUtm: string | null = null;
    let attributed = { revenue: 0, orders: 0 };

    if (c.utm_campaign_override) {
      const hit = revenueByUtm.get(c.utm_campaign_override.toLowerCase());
      if (hit) {
        matchedUtm = c.utm_campaign_override;
        matchConfidence = c.utm_mapping_confirmed ? "confirmed" : "guessed";
        attributed = hit;
      }
    } else {
      const guess = slugify(c.name);
      const hit = revenueByUtm.get(guess);
      if (hit) {
        matchedUtm = guess;
        matchConfidence = "guessed";
        attributed = hit;
      }
    }

    const platformRoas =
      perf.roasSamples.length > 0
        ? round(perf.roasSamples.reduce((s, v) => s + v, 0) / perf.roasSamples.length, 2)
        : perf.spend > 0
          ? round(perf.platformRevenue / perf.spend, 2)
          : null;

    return {
      campaignExternalId: c.external_id,
      campaignName: c.name,
      adAccountId: c.ad_accounts.id,
      platform: c.ad_accounts.platform,
      spend: round(perf.spend),
      platformReportedRevenue: round(perf.platformRevenue),
      platformReportedRoas: platformRoas,
      attributedRevenue: round(attributed.revenue),
      attributedOrders: attributed.orders,
      blendedRoas: perf.spend > 0 ? round(attributed.revenue / perf.spend, 2) : null,
      currency: c.ad_accounts.currency,
      matchConfidence,
      matchedUtmCampaign: matchedUtm,
    };
  });

  return results.sort((a, b) => b.spend - a.spend);
}

export interface AdRoasSummary {
  totalSpend: number;
  totalAttributedRevenue: number;
  blendedRoas: number | null;
  totalPlatformReportedRevenue: number;
  platformRoas: number | null;
  campaignsMatched: number;
  campaignsUnmatched: number;
  currency: string;
}

export async function getAdRoasSummary(tenantSlug: string, days = 30): Promise<AdRoasSummary> {
  const rows = await getAdCampaignRoas(tenantSlug, days);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalAttributedRevenue = rows.reduce((s, r) => s + r.attributedRevenue, 0);
  const totalPlatformReportedRevenue = rows.reduce((s, r) => s + r.platformReportedRevenue, 0);
  return {
    totalSpend: round(totalSpend),
    totalAttributedRevenue: round(totalAttributedRevenue),
    blendedRoas: totalSpend > 0 ? round(totalAttributedRevenue / totalSpend, 2) : null,
    totalPlatformReportedRevenue: round(totalPlatformReportedRevenue),
    platformRoas: totalSpend > 0 ? round(totalPlatformReportedRevenue / totalSpend, 2) : null,
    campaignsMatched: rows.filter((r) => r.matchConfidence !== "unmatched").length,
    campaignsUnmatched: rows.filter((r) => r.matchConfidence === "unmatched").length,
    currency: rows[0]?.currency ?? "NGN",
  };
}

/** Sets/confirms a campaign's UTM mapping override — the human-in-the-loop
 *  step that turns a "guessed" match into a "confirmed" one, or corrects a
 *  wrong guess entirely. */
export async function setAdCampaignUtmMapping(
  tenantSlug: string,
  adAccountId: string,
  campaignExternalId: string,
  utmCampaign: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("ad_campaigns")
    .update({ utm_campaign_override: utmCampaign, utm_mapping_confirmed: true })
    .eq("tenant_slug", tenantSlug)
    .eq("ad_account_id", adAccountId)
    .eq("external_id", campaignExternalId);
  if (error) throw new Error(`setAdCampaignUtmMapping: ${error.message}`);
}
