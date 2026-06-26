import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";

export interface PlatformScoreBreakdown {
  label: string;
  score: number;
  max: number;
}

export interface PlatformScore {
  platform: string;
  slug: "instagram" | "tiktok" | "twitter" | "linkedin";
  score: number;
  trend: "up" | "down" | "stable";
  breakdown: PlatformScoreBreakdown[];
  connected: boolean;
  hasData: boolean;
}

export interface PlatformScoreReport {
  overall: number;
  platforms: PlatformScore[];
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
};

const FREQUENCY_BENCHMARK = 12; // posts per 30 days → full score
const ENGAGEMENT_BENCHMARK = 8; // 8% ER → full score
const FOLLOWER_TIERS = [
  { threshold: 50000, score: 10 },
  { threshold: 10000, score: 8 },
  { threshold: 5000, score: 6 },
  { threshold: 1000, score: 4 },
  { threshold: 100, score: 2 },
  { threshold: 0, score: 0 },
];

function followerScore(followers: number): number {
  for (const tier of FOLLOWER_TIERS) {
    if (followers >= tier.threshold) return tier.score;
  }
  return 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function getPlatformScore(
  tenantSlug: string
): Promise<PlatformScoreReport> {
  const tenant = await getTenant(tenantSlug);
  const platformConfigs = tenant?.platforms ?? [];

  const supabase = await createClient();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Recent posts (last 30 days) + previous window (30-60 days ago) for trend.
  // Also pull from scheduled_posts (Pulse-published) for frequency — these
  // have no engagement data so they only boost the frequency dimension.
  const [recentPostsRes, priorPostsRes, recentPulseRes, priorPulseRes] = await Promise.all([
    supabase
      .from("posts")
      .select("platform, reach, likes, comments, shares, saves, posted_at")
      .eq("tenant_slug", tenantSlug)
      .gte("posted_at", thirtyDaysAgo),
    supabase
      .from("posts")
      .select("platform, reach, likes, comments, shares, saves")
      .eq("tenant_slug", tenantSlug)
      .gte("posted_at", sixtyDaysAgo)
      .lt("posted_at", thirtyDaysAgo),
    supabase
      .from("scheduled_posts")
      .select("platform, posted_at")
      .eq("tenant_slug", tenantSlug)
      .eq("status", "published")
      .gte("posted_at", thirtyDaysAgo),
    supabase
      .from("scheduled_posts")
      .select("platform, posted_at")
      .eq("tenant_slug", tenantSlug)
      .eq("status", "published")
      .gte("posted_at", sixtyDaysAgo)
      .lt("posted_at", thirtyDaysAgo),
  ]);

  const recentPosts = recentPostsRes.data ?? [];
  const priorPosts = priorPostsRes.data ?? [];
  const recentPulse = recentPulseRes.data ?? [];
  const priorPulse = priorPulseRes.data ?? [];

  // scheduled_posts uses "x"; score map uses "twitter". youtube is not scored.
  function normalizePlatform(p: string): string {
    return p === "x" ? "twitter" : p;
  }

  function erForPlatform(rows: { platform: string; reach: number; likes: number; comments: number; shares: number; saves: number }[], platform: string): number {
    const plat = rows.filter((r) => r.platform === platform);
    if (plat.length === 0) return 0;
    const total = plat.reduce((acc, r) => {
      if (!r.reach || r.reach <= 0) return acc;
      const eng = r.likes + r.comments + r.shares + r.saves;
      return acc + (eng / r.reach) * 100;
    }, 0);
    return total / plat.length;
  }

  const platforms: PlatformScore[] = (["instagram", "tiktok", "twitter", "linkedin"] as const).map((slug) => {
    const config = platformConfigs.find((p) => p.platform === slug);
    const recentForPlat = recentPosts.filter((r) => r.platform === slug);
    const pulseForPlat = recentPulse.filter((r) => normalizePlatform(r.platform) === slug);
    const postCount = recentForPlat.length + pulseForPlat.length;

    const freqScore = Math.round(clamp((postCount / FREQUENCY_BENCHMARK) * 10, 0, 10));

    const er = erForPlatform(recentPosts, slug);
    const priorEr = erForPlatform(priorPosts, slug);
    const erScore = Math.round(clamp((er / ENGAGEMENT_BENCHMARK) * 10, 0, 10));

    const connScore = config?.connected ? (config.status === "active" ? 10 : config.status === "needs_posts" ? 6 : 3) : 0;
    const followers = config?.followers ?? 0;
    const folScore = followerScore(followers);

    const hasData = postCount > 0 || followers > 0;

    // Composite: 40% frequency + 30% engagement + 20% audience + 10% connection health
    const score = hasData
      ? Math.round(freqScore * 4 + erScore * 3 + folScore * 2 + connScore * 1)
      : 0;

    // Trend from engagement-rate delta
    const trend: "up" | "down" | "stable" =
      priorEr === 0 && er === 0
        ? "stable"
        : er > priorEr * 1.1
          ? "up"
          : er < priorEr * 0.9
            ? "down"
            : "stable";

    const breakdown: PlatformScoreBreakdown[] = [
      { label: "Posts (last 30d)", score: freqScore, max: 10 },
      { label: "Engagement rate", score: erScore, max: 10 },
      { label: "Audience size", score: folScore, max: 10 },
      { label: "Connection health", score: connScore, max: 10 },
    ];

    return {
      platform: PLATFORM_LABELS[slug],
      slug,
      score,
      trend,
      breakdown,
      connected: config?.connected ?? false,
      hasData,
    };
  });

  const scored = platforms.filter((p) => p.hasData);
  const overall = scored.length === 0
    ? 0
    : Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length);

  return { overall, platforms };
}
