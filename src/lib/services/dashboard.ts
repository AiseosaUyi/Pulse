import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import type { DashboardStats, Suggestion } from "@/lib/types/dashboard";
import type { PlatformConnection } from "@/lib/types/tenant";
import type { OwnMetricsPayload } from "@/lib/types/own-metrics";

// Outbound pipeline states that count as "active" for the dashboard
// stat — anything pre-close/pre-dismiss. Mirrors /leads KPIs.
const ACTIVE_PROSPECT_STATUSES = [
  "new",
  "qualifying",
  "qualified",
  "drafted",
  "approved",
  "sent",
  "replied",
  "handed_off",
] as const;

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pct(a: number, b: number): string {
  if (b === 0) return a > 0 ? "new" : "0%";
  return `${Math.round(((a - b) / b) * 100)}%`;
}

// Reach per row: prefer explicit reach, fall back to views, then impressions.
function reachFromMetrics(m: OwnMetricsPayload | null | undefined): number {
  if (!m) return 0;
  return m.reach ?? m.views ?? m.impressions ?? 0;
}

export async function getDashboardStats(
  tenantSlug: string
): Promise<DashboardStats | null> {
  const supabase = await createClient();

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [ownThisWeek, ownPriorWeek, activeLeadsRes, adSpendRes, tenant] =
    await Promise.all([
      supabase
        .from("own_post_metrics")
        .select("metrics")
        .eq("tenant_slug", tenantSlug)
        .gte("captured_at", weekAgo.toISOString())
        .lte("captured_at", now.toISOString()),
      supabase
        .from("own_post_metrics")
        .select("metrics")
        .eq("tenant_slug", tenantSlug)
        .gte("captured_at", twoWeeksAgo.toISOString())
        .lt("captured_at", weekAgo.toISOString()),
      supabase
        .from("prospects")
        .select("id, status", { count: "exact", head: false })
        .eq("tenant_slug", tenantSlug)
        .in("status", ACTIVE_PROSPECT_STATUSES as unknown as string[]),
      supabase
        .from("campaigns")
        .select("spend")
        .eq("tenant_slug", tenantSlug)
        .eq("status", "active"),
      getTenant(tenantSlug),
    ]);

  if (!tenant) return null;

  const thisWeekReach =
    (ownThisWeek.data ?? []).reduce(
      (sum, r) => sum + reachFromMetrics(r.metrics as OwnMetricsPayload),
      0
    );
  const priorWeekReach =
    (ownPriorWeek.data ?? []).reduce(
      (sum, r) => sum + reachFromMetrics(r.metrics as OwnMetricsPayload),
      0
    );
  const postsThisWeek = ownThisWeek.data?.length ?? 0;

  const activeLeadsCount = activeLeadsRes.count ?? 0;
  // "Needs follow-up" = qualified prospects without a drafted/sent DM yet.
  const needsFollowup =
    activeLeadsRes.data?.filter(
      (l) => l.status === "qualified" || l.status === "new"
    ).length ?? 0;

  const adSpendTotal =
    adSpendRes.data?.reduce((sum, c) => sum + Number(c.spend ?? 0), 0) ?? 0;
  const activeCampaigns = adSpendRes.data?.length ?? 0;

  const connected = (tenant.platforms ?? []).filter((p) => p.connected).length;
  const profileScore = Math.round((connected / 4) * 100);

  return {
    socialReach: {
      label: "Social reach",
      value: formatReach(thisWeekReach),
      subtitle:
        postsThisWeek > 0
          ? `${postsThisWeek} post${postsThisWeek === 1 ? "" : "s"}, last 7 days`
          : "Import metrics on /own-analytics",
      change:
        priorWeekReach > 0
          ? {
              value: `${pct(thisWeekReach, priorWeekReach)} vs prior week`,
              direction:
                thisWeekReach > priorWeekReach
                  ? "up"
                  : thisWeekReach < priorWeekReach
                  ? "down"
                  : "neutral",
            }
          : undefined,
    },
    profileScore: {
      label: "Profile score",
      value: String(profileScore),
      subtitle: `${connected}/4 platforms connected`,
    },
    activeLeads: {
      label: "Active prospects",
      value: String(activeLeadsCount),
      subtitle:
        needsFollowup > 0
          ? `${needsFollowup} need follow-up`
          : activeLeadsCount === 0
            ? "Add via Outbound → Add prospect"
            : "All caught up",
    },
    adSpend: {
      label: "Ad spend (active)",
      value: String(adSpendTotal),
      subtitle:
        activeCampaigns > 0
          ? `${activeCampaigns} campaign${activeCampaigns === 1 ? "" : "s"} active`
          : "No active campaigns",
    },
    // Individual-account cards — aggregate engagement rate across own_post_metrics
    postsThisWeek: {
      label: "Posts this week",
      value: String(postsThisWeek),
      subtitle: postsThisWeek > 0 ? "last 7 days" : "Schedule via Composer",
    },
    avgEngagement: (() => {
      const rows = (ownThisWeek.data ?? []).map((r) => {
        const m = r.metrics as OwnMetricsPayload;
        const likes = m?.likes ?? 0;
        const comments = m?.comments ?? 0;
        const reach = reachFromMetrics(m);
        return reach > 0 ? ((likes + comments) / reach) * 100 : null;
      }).filter((v): v is number => v !== null);
      const avg = rows.length > 0 ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
      return {
        label: "Avg. engagement",
        value: avg !== null ? `${avg.toFixed(1)}%` : "—",
        subtitle: avg !== null ? "likes + comments / reach" : "Connect platforms to see",
      };
    })(),
  };
}

export async function getPlatforms(
  tenantSlug: string
): Promise<PlatformConnection[]> {
  const tenant = await getTenant(tenantSlug);
  return tenant?.platforms ?? [];
}

export async function getSuggestions(
  tenantSlug: string
): Promise<Suggestion[]> {
  // Reads from the most recent weekly_digest's recommended_actions.
  // Regenerating the digest via /weekly-report refreshes this.
  const supabase = await createClient();
  const { data } = await supabase
    .from("weekly_digests")
    .select("recommended_actions")
    .eq("tenant_slug", tenantSlug)
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  const actions = ((data?.recommended_actions ?? []) as Array<{
    priority: number;
    action: string;
    target_module: string | null;
    rationale: string;
  }>).sort((a, b) => a.priority - b.priority);

  return actions.slice(0, 4).map((a, i) => ({
    id: `digest-${i}`,
    title: a.action,
    description: a.rationale,
    impact:
      a.priority === 1
        ? "urgent"
        : a.priority === 2
        ? "high_impact"
        : "opportunity",
    targetModule: a.target_module ?? "/weekly-report",
  }));
}
