// Orders read layer. Server (RLS-scoped) client — members see their tenant's
// orders. Powers the /orders page and the attribution funnel.

import { createClient } from "@/lib/supabase/server";

export interface OrderRecord {
  id: string;
  externalId: string | null;
  source: string | null;
  channel: string;
  utmCampaign: string | null;
  utmContent: string | null;
  amount: number | null;
  currency: string;
  status: string;
  createdAt: string;
}

interface OrderRow {
  id: string;
  external_id: string | null;
  source: string | null;
  channel: string;
  utm_campaign: string | null;
  utm_content: string | null;
  amount: number | string | null;
  currency: string;
  status: string;
  created_at: string;
}

function rowTo(r: OrderRow): OrderRecord {
  return {
    id: r.id,
    externalId: r.external_id,
    source: r.source,
    channel: r.channel,
    utmCampaign: r.utm_campaign,
    utmContent: r.utm_content,
    amount: r.amount == null ? null : Number(r.amount),
    currency: r.currency,
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function listOrders(
  tenantSlug: string,
  limit = 100
): Promise<OrderRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, external_id, source, channel, utm_campaign, utm_content, amount, currency, status, created_at"
    )
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as OrderRow[]).map(rowTo);
}

export interface OrderStats {
  count: number;
  revenue: number;
  currency: string;
  attributedCount: number; // orders carrying a utm_campaign
}

export async function getOrderStats(
  tenantSlug: string,
  days = 30
): Promise<OrderStats> {
  const orders = await listOrders(tenantSlug, 1000);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const windowed = orders.filter(
    (o) => new Date(o.createdAt).getTime() >= since
  );
  return {
    count: windowed.length,
    revenue: windowed.reduce((sum, o) => sum + (o.amount ?? 0), 0),
    currency: windowed[0]?.currency ?? "NGN",
    attributedCount: windowed.filter((o) => o.utmCampaign).length,
  };
}
