import type {
  Campaign,
  CampaignPlatform,
  CampaignStatus,
  CampaignSummary,
} from "@/lib/types/campaigns";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

function round(n: number, places = 2): number {
  return Number(n.toFixed(places));
}

function derive(row: {
  spend: number;
  revenue: number;
  clicks: number;
  conversions: number;
}): { cpc: number; roas: number; costPerConversion: number } {
  const spend = Number(row.spend);
  const revenue = Number(row.revenue);
  const cpc = row.clicks > 0 ? round(spend / row.clicks) : 0;
  const roas = spend > 0 ? round(revenue / spend, 2) : 0;
  const costPerConversion = row.conversions > 0 ? round(spend / row.conversions) : 0;
  return { cpc, roas, costPerConversion };
}

function campaignRowTo(row: {
  id: string;
  tenant_slug: string;
  name: string;
  platform: string;
  status: string;
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}): Campaign {
  const { cpc, roas, costPerConversion } = derive(row);
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    platform: row.platform as CampaignPlatform,
    status: row.status as CampaignStatus,
    spend: Number(row.spend),
    revenue: Number(row.revenue),
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    cpc,
    roas,
    costPerConversion,
  };
}

export async function getCampaigns(tenantSlug: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map(campaignRowTo);
}

/** Client-injected, offset-paginated twin of getCampaigns() for /api/v1 + MCP. */
export async function listCampaignsApi(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { status?: CampaignStatus; limit?: number; offset?: number } = {}
): Promise<{ data: Campaign[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  let query = client
    .from("campaigns")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };
  return { data: data.map(campaignRowTo), total: count ?? 0 };
}

/** Client-injected twin of the dashboard's campaign-summary derivation,
 *  for /api/v1 + MCP (pulse_ads_overview) — pulls ALL campaigns (not
 *  paginated) so the summary totals are accurate regardless of list size. */
export async function getCampaignSummaryApi(
  client: SupabaseClient,
  tenantSlug: string
): Promise<CampaignSummary> {
  const { data, error } = await client
    .from("campaigns")
    .select("*")
    .eq("tenant_slug", tenantSlug);
  if (error || !data) return summarize([]);
  return summarize(data.map(campaignRowTo));
}

export function summarize(campaigns: Campaign[]): CampaignSummary {
  if (campaigns.length === 0) {
    return {
      total: 0,
      active: 0,
      totalSpend: 0,
      totalRevenue: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalConversions: 0,
      overallRoas: 0,
      avgCostPerConversion: 0,
    };
  }

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const totalRevenue = campaigns.reduce((sum, c) => sum + c.revenue, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
  const overallRoas = totalSpend > 0 ? round(totalRevenue / totalSpend, 2) : 0;
  const avgCostPerConversion =
    totalConversions > 0 ? Math.round(totalSpend / totalConversions) : 0;

  return {
    total: campaigns.length,
    active: campaigns.filter((c) => c.status === "active").length,
    totalSpend,
    totalRevenue,
    totalImpressions,
    totalClicks,
    totalConversions,
    overallRoas,
    avgCostPerConversion,
  };
}
