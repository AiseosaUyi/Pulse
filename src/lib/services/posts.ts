import type {
  Post,
  PostContentType,
  PostPerformance,
  PostPlatform,
  PostSummary,
} from "@/lib/types/posts";
import { createClient } from "@/lib/supabase/server";

const ABOVE_THRESHOLD = 1.15;
const BELOW_THRESHOLD = 0.85;

function computeEngagementRate(row: {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}): number {
  if (!row.reach || row.reach <= 0) return 0;
  const total = row.likes + row.comments + row.shares + row.saves;
  return Number(((total / row.reach) * 100).toFixed(1));
}

function classify(rate: number, avg: number): PostPerformance {
  if (avg <= 0) return "average";
  if (rate >= avg * ABOVE_THRESHOLD) return "above";
  if (rate <= avg * BELOW_THRESHOLD) return "below";
  return "average";
}

export async function getPosts(tenantSlug: string): Promise<Post[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("posted_at", { ascending: false });

  if (error || !data || data.length === 0) return [];

  const withRate = data.map((row) => ({
    row,
    engagementRate: computeEngagementRate(row),
  }));

  const avg =
    withRate.reduce((sum, p) => sum + p.engagementRate, 0) / withRate.length;

  return withRate.map(({ row, engagementRate }) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    title: row.title,
    platform: row.platform as PostPlatform,
    contentType: row.content_type as PostContentType,
    postedAt: row.posted_at,
    reach: row.reach,
    impressions: row.impressions,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    postUrl: row.post_url ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    engagementRate,
    performanceVsAvg: classify(engagementRate, avg),
  }));
}

export function summarize(posts: Post[]): PostSummary {
  if (posts.length === 0) {
    return { total: 0, totalReach: 0, totalLikes: 0, avgEngagement: 0, aboveAvg: 0 };
  }

  const totalReach = posts.reduce((sum, p) => sum + p.reach, 0);
  const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);
  const avgEngagement = Number(
    (posts.reduce((sum, p) => sum + p.engagementRate, 0) / posts.length).toFixed(1)
  );
  const aboveAvg = posts.filter((p) => p.performanceVsAvg === "above").length;

  return {
    total: posts.length,
    totalReach,
    totalLikes,
    avgEngagement,
    aboveAvg,
  };
}
