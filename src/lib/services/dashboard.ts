import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import type { DashboardStats, Suggestion } from "@/lib/types/dashboard";
import type { PlatformConnection } from "@/lib/types/tenant";

const ACTIVE_LEAD_STATUSES = ["new", "contacted", "warm"] as const;

function formatReach(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function pct(a: number, b: number): string {
  if (b === 0) return a > 0 ? "new" : "0%";
  return `${Math.round(((a - b) / b) * 100)}%`;
}

export async function getDashboardStats(
  tenantSlug: string
): Promise<DashboardStats | null> {
  const supabase = await createClient();

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [reachThisWeek, reachPriorWeek, activeLeadsRes, adSpendRes, tenant] =
    await Promise.all([
      supabase
        .from("posts")
        .select("reach")
        .eq("tenant_slug", tenantSlug)
        .gte("posted_at", weekAgo.toISOString())
        .lte("posted_at", now.toISOString()),
      supabase
        .from("posts")
        .select("reach")
        .eq("tenant_slug", tenantSlug)
        .gte("posted_at", twoWeeksAgo.toISOString())
        .lt("posted_at", weekAgo.toISOString()),
      supabase
        .from("leads")
        .select("id, status", { count: "exact", head: false })
        .eq("tenant_slug", tenantSlug)
        .in("status", ACTIVE_LEAD_STATUSES as unknown as string[]),
      supabase
        .from("campaigns")
        .select("spend")
        .eq("tenant_slug", tenantSlug)
        .eq("status", "active"),
      getTenant(tenantSlug),
    ]);

  if (!tenant) return null;

  const thisWeekReach =
    reachThisWeek.data?.reduce((sum, r) => sum + (r.reach ?? 0), 0) ?? 0;
  const priorWeekReach =
    reachPriorWeek.data?.reduce((sum, r) => sum + (r.reach ?? 0), 0) ?? 0;

  const activeLeadsCount = activeLeadsRes.count ?? 0;
  const needsFollowup =
    activeLeadsRes.data?.filter((l) => l.status === "new").length ?? 0;

  const adSpendTotal =
    adSpendRes.data?.reduce((sum, c) => sum + Number(c.spend ?? 0), 0) ?? 0;
  const activeCampaigns = adSpendRes.data?.length ?? 0;

  const connected = (tenant.platforms ?? []).filter((p) => p.connected).length;
  const profileScore = Math.round((connected / 4) * 100);

  return {
    socialReach: {
      label: "Social reach",
      value: formatReach(thisWeekReach),
      subtitle: "Last 7 days",
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
      label: "Active leads",
      value: String(activeLeadsCount),
      subtitle:
        needsFollowup > 0
          ? `${needsFollowup} need follow-up`
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
  };
}

export async function getPlatforms(
  tenantSlug: string
): Promise<PlatformConnection[]> {
  const tenant = await getTenant(tenantSlug);
  return tenant?.platforms ?? [];
}

export async function getSuggestions(
  _tenantSlug: string
): Promise<Suggestion[]> {
  // Suggestions will be rule-based once the insight engine is designed.
  return [];
}
