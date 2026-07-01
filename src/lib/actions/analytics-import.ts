"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
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
): Promise<{ success: true; inserted: number; updated: number } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!posts.length) return { success: false, error: "No posts" };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;

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
      source: "json_export" as const,
      metrics: Object.fromEntries(
        Object.entries(p.metrics).filter(([, v]) => v !== null && v !== undefined)
      ),
      created_at: now,
    }));

    const { data, error } = await admin
      .from("own_post_metrics")
      .upsert(rows, { onConflict: "tenant_slug,platform,captured_at", ignoreDuplicates: false });

    if (error) {
      // If upsert fails (e.g. no unique constraint), fall back to insert ignoring duplicates
      const { error: insertErr, count } = await admin
        .from("own_post_metrics")
        .insert(rows, { count: "exact" });
      if (!insertErr) inserted += count ?? batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { success: true, inserted, updated };
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

  // Aggregate metrics for context
  const totalImpressions = postsData.reduce((s, p) => s + (p.metrics.impressions ?? 0), 0);
  const totalLikes = postsData.reduce((s, p) => s + (p.metrics.likes ?? 0), 0);
  const totalEngagements = postsData.reduce((s, p) =>
    s + (p.metrics.engagements ?? (p.metrics.likes ?? 0) + (p.metrics.replies ?? 0) + (p.metrics.shares ?? 0)), 0
  );

  // Top posts by impressions or likes
  const sorted = [...postsData].sort((a, b) =>
    (b.metrics.impressions ?? b.metrics.likes ?? 0) - (a.metrics.impressions ?? a.metrics.likes ?? 0)
  );
  const topPosts = sorted.slice(0, 5).map((p) => ({
    date: p.capturedAt.slice(0, 10),
    caption: p.caption?.slice(0, 200),
    url: p.externalUrl,
    impressions: p.metrics.impressions,
    likes: p.metrics.likes,
    engagements: p.metrics.engagements,
  }));

  // Posting frequency
  const dates = postsData.map((p) => p.capturedAt.slice(0, 10)).sort();
  const periodDays = dates.length > 1
    ? Math.max(1, Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000))
    : 1;
  const postsPerWeek = ((postsData.length / periodDays) * 7).toFixed(1);

  const prompt = `You are a senior social media analyst reviewing ${platform} performance data for a brand.

Platform: ${platform}
Period: ${dates[0]} to ${dates[dates.length - 1]}
Total posts: ${postsData.length}
Posts/week: ${postsPerWeek}
Total impressions: ${totalImpressions.toLocaleString()}
Total likes: ${totalLikes.toLocaleString()}
Total engagements: ${totalEngagements.toLocaleString()}
Avg engagement rate: ${totalImpressions > 0 ? ((totalEngagements / totalImpressions) * 100).toFixed(2) : "N/A"}%

Top 5 posts by performance:
${topPosts.map((p, i) => `${i + 1}. [${p.date}] ${p.caption ?? "(no caption)"} — ${p.impressions ?? p.likes ?? 0} ${p.impressions != null ? "impressions" : "likes"}${p.url ? ` — ${p.url}` : ""}`).join("\n")}

Write a concise narrative (2-3 paragraphs) analyzing performance, trends, and what content resonates. Then give 4 specific, actionable recommendations for this platform. Be direct, data-grounded, and platform-savvy — not generic. Mention specific patterns you notice in the data.`;

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
