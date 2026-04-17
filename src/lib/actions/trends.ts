"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { getTenant } from "@/lib/services/tenants";
import { analyzeTrend } from "@/lib/ai/analyze-trend";
import type { TrendPlatform } from "@/lib/types/trends";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function addManualTrend(
  input: {
    tenantSlug: string;
    platform: TrendPlatform;
    hashtag?: string;
    externalUrl?: string;
    summary: string;
    metrics?: {
      views?: number;
      likes?: number;
      engagementRate?: number;
    };
  }
): Promise<ActionResult<{ trendId: string }>> {
  if (!input.summary.trim()) {
    return { success: false, error: "Summary is required" };
  }
  const supabase = await createClient();

  const [voice, tenant] = await Promise.all([
    getBrandVoice(input.tenantSlug),
    getTenant(input.tenantSlug),
  ]);

  let ai_analysis = null;
  let applicability: "high" | "medium" | "low" | "n/a" | null = null;
  try {
    if (tenant) {
      const analyzed = await analyzeTrend({
        tenantSlug: input.tenantSlug,
        tenantName: tenant.name,
        voice,
        platform: input.platform,
        summary: input.summary,
        hashtag: input.hashtag,
        metrics: input.metrics as Record<string, unknown>,
      });
      ai_analysis = analyzed;
      applicability = analyzed.applicability;
    }
  } catch {
    // non-fatal: trend row still inserts without analysis
  }

  const metricsPayload: Record<string, number> = {};
  if (input.metrics?.views !== undefined) metricsPayload.views = input.metrics.views;
  if (input.metrics?.likes !== undefined) metricsPayload.likes = input.metrics.likes;
  if (input.metrics?.engagementRate !== undefined)
    metricsPayload.engagement_rate = input.metrics.engagementRate;

  const { data, error } = await supabase
    .from("trend_scouts")
    .insert({
      tenant_slug: input.tenantSlug,
      platform: input.platform,
      source: "manual",
      hashtag: input.hashtag?.trim() || null,
      external_url: input.externalUrl?.trim() || null,
      summary: input.summary.trim(),
      metrics: metricsPayload,
      ai_analysis,
      applicability,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/viral-trends");
  return { success: true, trendId: data.id };
}

export async function dismissTrend(
  id: string,
  tenantSlug: string,
  reason?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("trend_scouts")
    .update({
      dismissed_at: new Date().toISOString(),
      dismissed_reason: reason?.trim() || null,
    })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/viral-trends");
  return { success: true };
}

export async function restoreTrend(
  id: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("trend_scouts")
    .update({ dismissed_at: null, dismissed_reason: null })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/viral-trends");
  return { success: true };
}
