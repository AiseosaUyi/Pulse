import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AnalyticsTotals,
  WebAnalyticsDaily,
} from "@/lib/types/analytics";

interface Row {
  id: string;
  tenant_slug: string;
  source: "ga4" | "manual";
  page_path: string;
  date: string;
  pageviews: number | string;
  sessions: number | string;
  users: number | string;
  engagement_time_sec: number | string;
  bounce_rate: number | string | null;
  conversions: number | string;
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowTo(row: Row): WebAnalyticsDaily {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    source: row.source,
    pagePath: row.page_path,
    date: row.date,
    pageviews: Number(row.pageviews ?? 0),
    sessions: Number(row.sessions ?? 0),
    users: Number(row.users ?? 0),
    engagementTimeSec: Number(row.engagement_time_sec ?? 0),
    bounceRate: Number(row.bounce_rate ?? 0),
    conversions: Number(row.conversions ?? 0),
    raw: row.raw ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDailyAnalytics(
  tenantSlug: string,
  options: { days?: number; path?: string } = {}
): Promise<WebAnalyticsDaily[]> {
  const supabase = await createClient();
  const since = new Date(
    Date.now() - (options.days ?? 30) * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  let query = supabase
    .from("web_analytics_daily")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(5000);
  if (options.path) query = query.eq("page_path", options.path);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

/**
 * Compute totals for a window. Pages aggregated by path so a stat
 * card can render "top 5 pages this week".
 */
export async function totalsForWindow(
  tenantSlug: string,
  days = 7
): Promise<AnalyticsTotals> {
  const rows = await listDailyAnalytics(tenantSlug, { days });
  const totals: AnalyticsTotals = {
    pageviews: 0,
    sessions: 0,
    users: 0,
    avgEngagementSec: 0,
    conversions: 0,
    topPages: [],
  };
  if (rows.length === 0) return totals;

  const byPage = new Map<
    string,
    { pageviews: number; conversions: number; engagementSec: number; sessions: number }
  >();
  let totalEngagementSec = 0;
  let totalSessions = 0;

  for (const r of rows) {
    totals.pageviews += r.pageviews;
    totals.sessions += r.sessions;
    totals.users += r.users;
    totals.conversions += r.conversions;
    totalEngagementSec += r.engagementTimeSec;
    totalSessions += r.sessions;
    const prev = byPage.get(r.pagePath) ?? {
      pageviews: 0,
      conversions: 0,
      engagementSec: 0,
      sessions: 0,
    };
    prev.pageviews += r.pageviews;
    prev.conversions += r.conversions;
    prev.engagementSec += r.engagementTimeSec;
    prev.sessions += r.sessions;
    byPage.set(r.pagePath, prev);
  }

  totals.avgEngagementSec =
    totalSessions > 0 ? Math.round(totalEngagementSec / totalSessions) : 0;
  totals.topPages = Array.from(byPage.entries())
    .map(([path, v]) => ({
      path,
      pageviews: v.pageviews,
      conversions: v.conversions,
    }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 5);

  return totals;
}

/**
 * Bulk-upsert daily metrics from a GA4 sync. Admin-scoped because the
 * cron caller may not have a user session.
 */
export async function upsertDailyAnalytics(
  tenantSlug: string,
  rows: Array<
    Omit<WebAnalyticsDaily, "id" | "createdAt" | "updatedAt" | "tenantSlug">
  >
): Promise<{ inserted: number; error?: string }> {
  if (rows.length === 0) return { inserted: 0 };
  const admin = createAdminClient();
  const payload = rows.map((r) => ({
    tenant_slug: tenantSlug,
    source: r.source,
    page_path: r.pagePath,
    date: r.date,
    pageviews: r.pageviews,
    sessions: r.sessions,
    users: r.users,
    engagement_time_sec: r.engagementTimeSec,
    bounce_rate: r.bounceRate,
    conversions: r.conversions,
    raw: r.raw,
  }));
  const { error, data } = await admin
    .from("web_analytics_daily")
    .upsert(payload, { onConflict: "tenant_slug,source,page_path,date" })
    .select("id");
  if (error) return { inserted: 0, error: error.message };
  return { inserted: data?.length ?? 0 };
}
