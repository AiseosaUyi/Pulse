"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getModel, getModelId, logAiCall, estimateCostUsd } from "@/lib/ai/gateway";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

export interface ImportablePost {
  capturedAt: string; // ISO
  platform: OwnMetricsPlatform;
  caption?: string | null;
  externalUrl?: string | null;
  mediaType?: string | null;
  metrics: {
    impressions?: number | null;
    engagements?: number | null;
    likes?: number | null;
    retweets?: number | null;
    replies?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    views?: number | null;
    bookmarks?: number | null;
    videoViews?: number | null;
    profileClicks?: number | null;
    reach?: number | null;
    engagement_rate?: number | null;
  };
}

export async function importAnalyticsPosts(
  tenantSlug: string,
  posts: ImportablePost[]
): Promise<{ success: true; inserted: number; updated: number; batchId: string } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!posts.length) return { success: false, error: "No posts" };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  let inserted = 0;
  const updated = 0;

  // Compute batch metadata from the incoming posts
  const platform = posts[0].platform;
  const dates = posts.map((p) => p.capturedAt.slice(0, 10)).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];
  const startLabel = new Date(periodStart).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const endLabel = new Date(periodEnd).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const label = startLabel === endLabel
    ? `${startLabel} · ${posts.length} posts`
    : `${startLabel} – ${endLabel} · ${posts.length} posts`;

  // Create the import session first to get the batch id
  const { data: sessionData, error: sessionErr } = await admin
    .from("analytics_import_sessions")
    .insert({
      tenant_slug: tenantSlug,
      platform,
      post_count: posts.length,
      period_start: periodStart,
      period_end: periodEnd,
      imported_at: now,
      label,
    })
    .select("id")
    .single();

  const batchId: string | null = sessionErr ? null : (sessionData as { id: string }).id;

  const BATCH = 50;
  for (let i = 0; i < posts.length; i += BATCH) {
    const batch = posts.slice(i, i + BATCH);
    const rows = batch.map((p) => ({
      tenant_slug: tenantSlug,
      platform: p.platform,
      external_url: p.externalUrl ?? null,
      title: p.caption?.slice(0, 500) ?? null,
      caption: p.caption ?? null,
      captured_at: p.capturedAt,
      source: "csv" as const,
      metrics: Object.fromEntries(
        Object.entries(p.metrics).filter(([, v]) => v !== null && v !== undefined)
      ),
      created_at: now,
      ...(batchId ? { import_batch_id: batchId } : {}),
    }));

    // Upsert on (tenant_slug, platform, captured_at) — requires mig 083 unique index.
    const { error } = await admin
      .from("own_post_metrics")
      .upsert(rows, { onConflict: "tenant_slug,platform,captured_at", ignoreDuplicates: true });

    if (error) {
      const { error: insertErr, count } = await admin
        .from("own_post_metrics")
        .insert(rows, { count: "exact" });
      if (!insertErr) inserted += count ?? batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { success: true, inserted, updated, batchId: batchId ?? "" };
}

const AnalysisSchema = z.object({
  narrative: z.string(),
  recommendations: z.array(z.object({ title: z.string(), body: z.string() })),
  growthActions: z.array(z.object({
    title: z.string(),
    impact: z.string(),
    timeframe: z.string(),
    body: z.string(),
  })),
  frequencyVerdict: z.object({
    current: z.string(),
    recommended: z.string(),
    gap: z.string(),
  }),
  projections: z.object({
    conservative: z.string(),
    withViralMoment: z.string(),
    keyMultiplier: z.string(),
    viralPotential: z.string(),
  }),
  missingData: z.array(z.string()),
  contentInsights: z.array(z.object({
    type: z.string(),
    count: z.number(),
    verdict: z.string(),
  })),
  rawMetrics: z.object({
    totalPosts: z.number(),
    totalImpressions: z.nullable(z.number()),
    totalEngagements: z.nullable(z.number()),
    avgEngagementRate: z.nullable(z.number()),
    totalLikes: z.number(),
    bestDay: z.nullable(z.string()),
    postingFrequency: z.string(),
  }),
});

export async function generateAnalyticsReport(
  tenantSlug: string,
  platform: OwnMetricsPlatform | "all",
  postsData: ImportablePost[]
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!postsData.length) return { success: false, error: "No data" };

  const admin = createAdminClient();
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");

  // Aggregate metrics
  const totalImpressions = postsData.reduce((s, p) => s + (p.metrics.impressions ?? 0), 0);
  const totalReach = postsData.reduce((s, p) => s + (p.metrics.reach ?? 0), 0);
  const totalLikes = postsData.reduce((s, p) => s + (p.metrics.likes ?? 0), 0);
  const totalShares = postsData.reduce((s, p) => s + (p.metrics.shares ?? 0), 0);
  const totalSaves = postsData.reduce((s, p) => s + (p.metrics.saves ?? 0), 0);
  const totalComments = postsData.reduce((s, p) => s + (p.metrics.comments ?? 0), 0);
  const totalEngagements = postsData.reduce((s, p) =>
    s + (p.metrics.engagements ?? (p.metrics.likes ?? 0) + (p.metrics.replies ?? 0) + (p.metrics.shares ?? 0) + (p.metrics.comments ?? 0)), 0
  );

  // Content type breakdown
  const byType = new Map<string, { count: number; impressions: number; likes: number; saves: number }>();
  for (const p of postsData) {
    const type = (p.mediaType ?? "post").toLowerCase();
    const cur = byType.get(type) ?? { count: 0, impressions: 0, likes: 0, saves: 0 };
    byType.set(type, {
      count: cur.count + 1,
      impressions: cur.impressions + (p.metrics.impressions ?? 0),
      likes: cur.likes + (p.metrics.likes ?? 0),
      saves: cur.saves + (p.metrics.saves ?? 0),
    });
  }
  const contentTypeLines = Array.from(byType.entries()).map(([type, d]) => {
    const avgImpr = d.count > 0 ? Math.round(d.impressions / d.count) : 0;
    return `  ${type}: ${d.count} posts · avg ${avgImpr.toLocaleString()} impressions · ${d.likes.toLocaleString()} likes · ${d.saves.toLocaleString()} saves`;
  }).join("\n");

  const storiesInData = byType.has("story") || byType.has("stories");

  // Monthly breakdown
  const byMonth = new Map<string, { posts: number; impressions: number; likes: number; engagements: number }>();
  for (const p of postsData) {
    const month = p.capturedAt.slice(0, 7);
    const cur = byMonth.get(month) ?? { posts: 0, impressions: 0, likes: 0, engagements: 0 };
    const eng = p.metrics.engagements ?? (p.metrics.likes ?? 0) + (p.metrics.replies ?? 0) + (p.metrics.shares ?? 0) + (p.metrics.comments ?? 0);
    byMonth.set(month, {
      posts: cur.posts + 1,
      impressions: cur.impressions + (p.metrics.impressions ?? 0),
      likes: cur.likes + (p.metrics.likes ?? 0),
      engagements: cur.engagements + eng,
    });
  }
  const monthlyRows = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  const monthlyBreakdown = monthlyRows.map(([month, m]) => {
    const label = new Date(month + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    const er = m.impressions > 0 ? ((m.engagements / m.impressions) * 100).toFixed(1) + "%" : "—";
    return `  ${label}: ${m.posts} posts · ${m.impressions.toLocaleString()} impressions · ${m.likes.toLocaleString()} likes · ER ${er}`;
  }).join("\n");

  const sortedByImpression = [...monthlyRows].sort((a, b) => b[1].impressions - a[1].impressions);
  const bestMonth = sortedByImpression[0];
  const worstMonth = sortedByImpression[sortedByImpression.length - 1];

  // Top posts
  const sorted = [...postsData].sort((a, b) =>
    (b.metrics.impressions ?? b.metrics.likes ?? 0) - (a.metrics.impressions ?? a.metrics.likes ?? 0)
  );
  const topPosts = sorted.slice(0, 8).map((p) => ({
    date: p.capturedAt.slice(0, 10),
    caption: p.caption?.slice(0, 200),
    mediaType: p.mediaType,
    impressions: p.metrics.impressions,
    likes: p.metrics.likes,
    saves: p.metrics.saves,
    shares: p.metrics.shares,
  }));

  // Posting frequency
  const dates = postsData.map((p) => p.capturedAt.slice(0, 10)).sort();
  const periodDays = dates.length > 1
    ? Math.max(1, Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000))
    : 1;
  const postsPerWeek = ((postsData.length / periodDays) * 7).toFixed(1);

  const platformGuidance: Record<string, string> = {
    instagram: "TEAM CONTEXT: One marketer + one content creator who is frequently unavailable. Realistic stretched maximum: 2–3 feed posts/week, 1 Reel/week (up to 2 on a good week), 1–3 stories/day (achievable by repurposing feed posts to stories, resharing older archived stories, and using behind-the-scenes clips). Consistency beats volume — 2 posts/week every week is better than 7 one week and 0 the next. Reels are the #1 growth lever (algorithm distributes them to non-followers) so protecting at least 1 Reel/week is the top priority even if everything else drops. Carousels drive saves and compound over time. Stories build retention but don't grow new followers — repurposing is fine.",
    twitter: "X/Twitter rewards high-frequency original tweets (5–10/day for fast-growing accounts), threads for depth, and reply-farming (engaging in trending conversations). Quote tweets with takes drive impressions far above normal posts. Posting windows: 8am, 12pm, 5pm in the audience's timezone.",
    tiktok: "TikTok rewards volume and iteration: 2–4 videos/day is normal for fast-growing accounts. The For You page distributes to non-followers based on watch-time and completion rate. Hooks in the first 1–3 seconds are everything. Trending sounds multiply reach 3–5x.",
    linkedin: "LinkedIn rewards 3–5 posts/week. Carousels (PDF documents) get the highest organic reach. Personal stories + professional insight outperform company news. Comments in the first hour heavily influence algorithmic reach.",
  };

  const prompt = `You are a world-class social media growth strategist. Your job is to analyze this ${platform} account's data and build a SPECIFIC, AMBITIOUS but REALISTIC plan to grow followers and visibility 10x over 12 months. Recommendations must be achievable by a small team with the help of AI content tools. Do not give generic advice. Every recommendation must be rooted in this account's actual data.

BEDROCK PRINCIPLES — apply these to every analysis, for every brand, always:
1. CADENCE IS THE FLOOR, NOT THE CEILING. More consistent posting grows reach linearly. It won't 10x anything by itself. Name what cadence realistically delivers vs what a breakout moment delivers.
2. ONE REEL THAT LANDS IS THE MULTIPLIER. A single piece of content that hits the algorithm's distribution window can deliver what 3 months of cadence can't. The entire strategy must be oriented around making that happen repeatedly.
3. CATEGORY SHAREABILITY DETERMINES THE CEILING. Assess whether this account's niche is inherently shareable (drinks, food, events, parties, fashion, fitness, humor = high virality potential; B2B, professional services, niche hobbies = lower). A drinks or events brand has a massive natural advantage — people tag friends, share to stories, save for their next party. Name this explicitly.
4. UGC IS FREE CONTENT. Real moments — events, customers, deliveries, behind the scenes — should be systematically captured and repurposed. This is the most authentic content and the algorithm rewards it.
5. 10X REQUIRES A BREAKOUT MOMENT. Without at least 1-2 pieces of content hitting wide distribution per quarter, cadence alone gets you 2-4x over 12 months. Be honest about this.
6. HOOKS ARE EVERYTHING FOR REELS. The first 1-3 seconds determine whether the algorithm distributes to non-followers. Every Reel recommendation must include a hook strategy.
7. BE HONEST ABOUT TRAJECTORY. If current execution pattern continues unchanged, say exactly what outcome to expect. Avoid false optimism.

PLATFORM: ${platform}
PERIOD ANALYSED: ${dates[0]} to ${dates[dates.length - 1]}
DATA IN THIS REPORT: ${postsData.length} posts, avg ${postsPerWeek} posts/week

⚠️ DATA GAPS (you MUST account for these — they affect your recommendations):
${!storiesInData ? `- STORIES NOT IN DATA: Instagram Stories analytics are in a separate export file. If the account posts daily stories, those impressions and views are completely missing from this analysis. You must flag this and factor it into frequency recommendations.` : ""}
- Follower count history is NOT in this data — you cannot calculate follower growth rate. Flag this.
- Profile visits, website clicks, and story metrics are not included unless they appear above.
- You do not know the current follower count. Ask for it in missingData.

PLATFORM ALGORITHM CONTEXT:
${platformGuidance[platform] ?? "Post consistently, engage with comments in the first hour, use relevant hashtags."}

OVERALL METRICS:
- Total impressions: ${totalImpressions.toLocaleString()}
${totalReach > 0 ? `- Total reach: ${totalReach.toLocaleString()}` : ""}
- Total likes: ${totalLikes.toLocaleString()}
${totalSaves > 0 ? `- Total saves: ${totalSaves.toLocaleString()}` : ""}
${totalShares > 0 ? `- Total shares: ${totalShares.toLocaleString()}` : ""}
${totalComments > 0 ? `- Total comments: ${totalComments.toLocaleString()}` : ""}
- Total engagements: ${totalEngagements.toLocaleString()}
- Avg engagement rate: ${totalImpressions > 0 ? ((totalEngagements / totalImpressions) * 100).toFixed(2) : "N/A"}%
${bestMonth ? `- Best month: ${bestMonth[0]} (${bestMonth[1].impressions.toLocaleString()} impressions)` : ""}
${worstMonth && worstMonth[0] !== bestMonth?.[0] ? `- Weakest month: ${worstMonth[0]} (${worstMonth[1].impressions.toLocaleString()} impressions)` : ""}

CONTENT TYPE BREAKDOWN:
${contentTypeLines || "  No media type data available"}

MONTHLY BREAKDOWN:
${monthlyBreakdown}

TOP 8 POSTS BY PERFORMANCE (study these for patterns):
${topPosts.map((p, i) => `${i + 1}. [${p.date}] [${p.mediaType ?? "post"}] ${p.caption ?? "(no caption)"} — ${(p.impressions ?? p.likes ?? 0).toLocaleString()} ${p.impressions != null ? "impr" : "likes"}${p.saves ? `, ${p.saves} saves` : ""}${p.shares ? `, ${p.shares} shares` : ""}`).join("\n")}

YOUR OUTPUT MUST INCLUDE:

narrative: 3 paragraphs — (1) honest assessment of current trajectory, naming which months grew vs declined and why based on data, (2) what content types and behaviors are driving results vs what's holding the account back, (3) what cadence alone delivers vs what happens when a Reel breaks through — name both scenarios with real numbers, and assess whether this brand's content category has natural virality potential. Be direct. Name the numbers.

recommendations: 5 specific, numbered tactical actions. Each must reference actual data points from this account. No filler.

growthActions: 5 growth-specific plays to 10x followers/visibility. Each needs:
  - title: short action name
  - impact: "Critical" | "High" | "Medium"
  - timeframe: "This week" | "This month" | "Ongoing" | "Next 90 days"
  - body: exactly what to do, referencing the account's data and the platform algorithm. All recommendations must be achievable by ONE marketer + ONE unreliable content creator at their realistic maximum: 2–3 feed posts/week, 1 Reel/week as the priority, 1–3 stories/day via repurposing. Do not recommend higher volumes than this.

frequencyVerdict:
  - current: actual current posting pace (calculate from this data — posts/week, broken down by type if possible)
  - recommended: the realistic maximum for a one-marketer + one-unreliable-content-creator team stretched to capacity (2–3 feed posts/week, 1 Reel/week minimum, 1–3 stories/day via repurposing)
  - gap: what specifically needs to change to reach that pace, given the team constraint

projections: 12-month outlook based on the data and the team constraint:
  - conservative: what consistent cadence alone (2-3 posts/week, 1 Reel/week, no viral moment) realistically delivers — be specific (e.g. "~2,500–3,500 followers from current 915")
  - withViralMoment: what happens if 1–2 Reels hit wide distribution per quarter — specific follower range
  - keyMultiplier: the single highest-leverage action that separates the conservative and viral-moment scenarios — what exactly needs to happen
  - viralPotential: honest rating of how shareable this account's content category is (High / Medium / Low) with a one-sentence reason

missingData: list every piece of data that would make this analysis significantly better — be specific (e.g. "Current follower count to calculate follower growth rate", "Stories analytics file from Instagram export", "Reach by content type", "Hashtag performance data", "Profile visit data"). List at least 4–6 items.

contentInsights: for each content type in the data, give a verdict on whether it's working and what to change.

rawMetrics: compute from the data above.`;


  const start = Date.now();
  try {
    const { text, usage } = await generateText({
      model,
      output: Output.object({ schema: AnalysisSchema }),
      prompt,
    });

    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "analytics",
      model: modelId,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: cost,
      durationMs: Date.now() - start,
      success: true,
    });

    const parsed = AnalysisSchema.parse(JSON.parse(text));

    await admin.from("analytics_ai_reports").insert({
      tenant_slug: tenantSlug,
      platform,
      post_count: postsData.length,
      period_start: dates[0] ?? null,
      period_end: dates[dates.length - 1] ?? null,
      narrative: parsed.narrative,
      recommendations: parsed.recommendations,
      raw_metrics: {
        ...parsed.rawMetrics,
        growthActions: parsed.growthActions,
        frequencyVerdict: parsed.frequencyVerdict,
        projections: parsed.projections,
        missingData: parsed.missingData,
        contentInsights: parsed.contentInsights,
      },
    });

    return { success: true };
  } catch (err) {
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "analytics",
      model: modelId,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - start,
      success: false,
      errorMessage: String(err),
    });
    return { success: false, error: String(err) };
  }
}

/** Owner-only: delete all analytics data for one platform from the current tenant. */
export async function clearPlatformMetrics(
  platform: OwnMetricsPlatform
): Promise<{ success: true; deleted: number } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const membership = await getCurrentTenant();
  if (!membership) return { success: false, error: "No active tenant" };
  if (membership.role !== "owner") return { success: false, error: "Only owners can clear analytics data" };

  const tenantSlug = membership.slug;
  const admin = createAdminClient();

  const { error: metricsErr, count: metricsCount } = await admin
    .from("own_post_metrics")
    .delete({ count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform);

  if (metricsErr) return { success: false, error: metricsErr.message };

  // Also remove AI reports and import sessions for this platform
  await admin.from("analytics_ai_reports").delete().eq("tenant_slug", tenantSlug).eq("platform", platform);
  await admin.from("analytics_import_sessions").delete().eq("tenant_slug", tenantSlug).eq("platform", platform);

  return { success: true, deleted: metricsCount ?? 0 };
}

export async function getLatestReport(tenantSlug: string, platform: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("analytics_ai_reports")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
