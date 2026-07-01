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

  // Best month by engagement
  const bestMonth = monthlyRows.sort((a, b) => b[1].impressions - a[1].impressions)[0];
  const worstMonth = monthlyRows.sort((a, b) => a[1].impressions - b[1].impressions)[0];

  // Top posts by impressions or likes
  const sorted = [...postsData].sort((a, b) =>
    (b.metrics.impressions ?? b.metrics.likes ?? 0) - (a.metrics.impressions ?? a.metrics.likes ?? 0)
  );
  const topPosts = sorted.slice(0, 8).map((p) => ({
    date: p.capturedAt.slice(0, 10),
    caption: p.caption?.slice(0, 200),
    url: p.externalUrl,
    impressions: p.metrics.impressions,
    likes: p.metrics.likes,
    saves: p.metrics.saves,
    shares: p.metrics.shares,
    engagements: p.metrics.engagements,
  }));

  // Posting frequency
  const dates = postsData.map((p) => p.capturedAt.slice(0, 10)).sort();
  const periodDays = dates.length > 1
    ? Math.max(1, Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000))
    : 1;
  const postsPerWeek = ((postsData.length / periodDays) * 7).toFixed(1);

  const prompt = `You are a senior social media analyst reviewing ${platform} performance data for a brand.

PLATFORM: ${platform}
PERIOD: ${dates[0]} to ${dates[dates.length - 1]} (${postsData.length} posts, ${postsPerWeek}/week avg)

OVERALL METRICS:
- Total impressions: ${totalImpressions.toLocaleString()}
${totalReach > 0 ? `- Total reach: ${totalReach.toLocaleString()}` : ""}
- Total likes: ${totalLikes.toLocaleString()}
${totalSaves > 0 ? `- Total saves: ${totalSaves.toLocaleString()}` : ""}
${totalShares > 0 ? `- Total shares: ${totalShares.toLocaleString()}` : ""}
${totalComments > 0 ? `- Total comments: ${totalComments.toLocaleString()}` : ""}
- Total engagements: ${totalEngagements.toLocaleString()}
- Avg engagement rate: ${totalImpressions > 0 ? ((totalEngagements / totalImpressions) * 100).toFixed(2) : "N/A"}%
${bestMonth ? `- Best month (impressions): ${bestMonth[0]}` : ""}
${worstMonth && worstMonth[0] !== bestMonth?.[0] ? `- Weakest month: ${worstMonth[0]}` : ""}

MONTHLY BREAKDOWN:
${monthlyBreakdown}

TOP 8 POSTS BY PERFORMANCE:
${topPosts.map((p, i) => `${i + 1}. [${p.date}] ${p.caption ?? "(no caption)"} — ${(p.impressions ?? p.likes ?? 0).toLocaleString()} ${p.impressions != null ? "impressions" : "likes"}${p.saves ? `, ${p.saves} saves` : ""}${p.url ? ` — ${p.url}` : ""}`).join("\n")}

Analyze this data as a senior analyst. Write 2–3 focused paragraphs covering:
1. Overall trajectory and which months showed notable growth or decline and why (based on data patterns)
2. What content and behaviors drove the best results — look for patterns in top posts
3. Notable opportunities the brand should act on

Then give 4 specific, actionable recommendations tailored to this platform and the patterns you see. Reference actual months and numbers. Be direct and data-grounded, not generic.`;


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
      raw_metrics: parsed.rawMetrics,
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
