// 30-day post metrics snapshot — the basis for the recommendation moat
// (PULSE-SEO-SPEC.md §9). Reads web_analytics_daily, best-effort matched
// by slug in page_path. Degrades to { captured: false } when there is no
// analytics data so apply/outcome never hard-fail.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PostMetricsSnapshot {
  captured: boolean;
  window_days: number;
  from: string;
  to: string;
  pageviews: number;
  sessions: number;
  users: number;
  conversions: number;
  avg_bounce_rate: number;
}

export async function snapshotPostMetrics(
  supabase: SupabaseClient,
  tenantSlug: string,
  slug: string,
  windowDays = 30
): Promise<PostMetricsSnapshot> {
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86_400_000);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const empty: PostMetricsSnapshot = {
    captured: false,
    window_days: windowDays,
    from: fromDate,
    to: toDate,
    pageviews: 0,
    sessions: 0,
    users: 0,
    conversions: 0,
    avg_bounce_rate: 0,
  };

  if (!slug) return empty;

  const { data, error } = await supabase
    .from("web_analytics_daily")
    .select("pageviews, sessions, users, conversions, bounce_rate")
    .eq("tenant_slug", tenantSlug)
    .gte("date", fromDate)
    .lte("date", toDate)
    .ilike("page_path", `%${slug}%`);

  if (error || !data || data.length === 0) return empty;

  const sum = data.reduce(
    (a, r) => ({
      pageviews: a.pageviews + (r.pageviews ?? 0),
      sessions: a.sessions + (r.sessions ?? 0),
      users: a.users + (r.users ?? 0),
      conversions: a.conversions + (r.conversions ?? 0),
      bounce: a.bounce + Number(r.bounce_rate ?? 0),
    }),
    { pageviews: 0, sessions: 0, users: 0, conversions: 0, bounce: 0 }
  );

  return {
    captured: true,
    window_days: windowDays,
    from: fromDate,
    to: toDate,
    pageviews: sum.pageviews,
    sessions: sum.sessions,
    users: sum.users,
    conversions: sum.conversions,
    avg_bounce_rate: Number((sum.bounce / data.length).toFixed(4)),
  };
}
