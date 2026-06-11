// Post → order attribution funnel. Deterministic (no AI) so it can't hallucinate
// numbers. Reads posts / link_clicks / orders for a window and rolls them up by
// campaign. Used by the weekly digest and the system surfaces that answer
// "did anything Pulse published actually sell drinks?".

import { createAdminClient } from "@/lib/supabase/admin";

export interface CampaignAttribution {
  campaign: string;
  orders: number;
  revenue: number;
}

export interface AttributionSummary {
  postsPublished: number;
  linkClicks: number;
  orders: number;
  revenue: number;
  currency: string;
  topCampaigns: CampaignAttribution[];
}

export async function getAttributionSummary(
  tenantSlug: string,
  days = 7
): Promise<AttributionSummary> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [postsRes, clicksRes, ordersRes] = await Promise.all([
    admin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .not("post_url", "is", null)
      .gte("created_at", since),
    admin
      .from("link_clicks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .gte("clicked_at", since),
    admin
      .from("orders")
      .select("amount, currency, utm_campaign")
      .eq("tenant_slug", tenantSlug)
      .gte("created_at", since),
  ]);

  const orderRows =
    (ordersRes.data as Array<{
      amount: number | string | null;
      currency: string | null;
      utm_campaign: string | null;
    }>) ?? [];

  let revenue = 0;
  let currency = "NGN";
  const byCampaign = new Map<string, { orders: number; revenue: number }>();
  for (const o of orderRows) {
    const amt = Number(o.amount ?? 0);
    revenue += amt;
    if (o.currency) currency = o.currency;
    const key = o.utm_campaign ?? "(none)";
    const prev = byCampaign.get(key) ?? { orders: 0, revenue: 0 };
    prev.orders += 1;
    prev.revenue += amt;
    byCampaign.set(key, prev);
  }

  const topCampaigns = [...byCampaign.entries()]
    .map(([campaign, v]) => ({ campaign, orders: v.orders, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
    .slice(0, 5);

  return {
    postsPublished: postsRes.count ?? 0,
    linkClicks: clicksRes.count ?? 0,
    orders: orderRows.length,
    revenue,
    currency,
    topCampaigns,
  };
}
