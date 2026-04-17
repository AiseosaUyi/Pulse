"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { generateBrief, BriefGenerationError } from "@/lib/ai/generate-brief";
import type { PatternCluster } from "@/lib/ai/group-patterns";
import type { IntelCard } from "@/lib/types/intelligence";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function generateBriefFromCard(
  cardId: string,
  tenantSlug: string
): Promise<ActionResult<{ briefId: string }>> {
  const supabase = await createClient();

  const { data: card, error: cardErr } = await supabase
    .from("intel_cards")
    .select("*")
    .eq("id", cardId)
    .eq("tenant_id", tenantSlug)
    .maybeSingle();
  if (cardErr || !card) {
    return { success: false, error: "Intel card not found" };
  }

  const [voice, tenant] = await Promise.all([
    getBrandVoice(tenantSlug),
    getTenant(tenantSlug),
  ]);
  if (!voice) {
    return {
      success: false,
      error: "Brand voice not configured. Add one in Settings → Brand Voice.",
    };
  }
  if (!tenant) {
    return { success: false, error: "Tenant not found" };
  }

  const intelCard: IntelCard = {
    id: card.id,
    tenantId: card.tenant_id,
    competitorId: card.competitor_id,
    competitorName: card.competitor_name,
    competitorType: card.competitor_type,
    platform: card.platform,
    contentType: card.content_type,
    summary: card.summary,
    postUrl: card.post_url,
    metrics: card.metrics ?? {},
    aiRecommendation: card.ai_recommendation,
    detectedAt: card.detected_at,
    source: card.source,
  };
  const cluster: PatternCluster = {
    name: `${card.platform} ${card.content_type}`,
    key: `${card.platform}|${card.content_type}`,
    cards: [intelCard],
    avgVsAverage: intelCard.metrics.vsAverage ?? 1,
    avgEngagementRate: intelCard.metrics.engagementRate ?? 0,
  };

  try {
    const brief = await generateBrief({
      tenantSlug,
      tenantName: tenant.name,
      cluster,
      voice,
    });

    const { data: inserted, error } = await supabase
      .from("content_briefs")
      .insert({
        tenant_id: tenantSlug,
        triggered_by: cardId,
        triggered_by_type: "intel_card",
        platform: card.platform,
        content_type: card.content_type,
        title: brief.title,
        outline: brief.outline,
        draft_content: brief.draftContent,
        seo_keywords: brief.seoKeywords ?? [],
        status: "draft",
        generator_model: "openai/gpt-5",
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return { success: false, error: error?.message ?? "Insert failed" };
    }

    revalidatePath("/intel-feed");
    revalidatePath("/content-briefs");
    return { success: true, briefId: inserted.id };
  } catch (err) {
    const msg =
      err instanceof BriefGenerationError
        ? "AI generation failed. Please try again."
        : err instanceof Error
        ? err.message
        : "Unknown error";
    return { success: false, error: msg };
  }
}

export async function updateBriefStatus(
  briefId: string,
  tenantSlug: string,
  status: "draft" | "approved" | "published"
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_briefs")
    .update({ status })
    .eq("id", briefId)
    .eq("tenant_id", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-briefs");
  return { success: true };
}

export async function dismissBrief(
  briefId: string,
  tenantSlug: string,
  reason?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_briefs")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      dismissed_reason: reason?.trim() || null,
    })
    .eq("id", briefId)
    .eq("tenant_id", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-briefs");
  return { success: true };
}

export async function saveBriefContent(
  briefId: string,
  tenantSlug: string,
  patch: { title?: string; draftContent?: string; seoKeywords?: string[] }
): Promise<ActionResult> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.draftContent !== undefined) update.draft_content = patch.draftContent;
  if (patch.seoKeywords !== undefined) update.seo_keywords = patch.seoKeywords;
  if (Object.keys(update).length === 0) return { success: true };
  const { error } = await supabase
    .from("content_briefs")
    .update(update)
    .eq("id", briefId)
    .eq("tenant_id", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-briefs");
  return { success: true };
}

export async function updateBrandVoice(
  tenantSlug: string,
  voice: {
    tone: string;
    audience: string;
    do_list: string[];
    dont_list: string[];
    example_posts: string[];
  }
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .single();
  const settings = {
    ...((tenant?.settings as Record<string, unknown>) ?? {}),
    brand_voice: voice,
  };
  const { error } = await supabase
    .from("tenants")
    .update({ settings })
    .eq("slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/brand-voice");
  revalidatePath("/content-briefs");
  return { success: true };
}
