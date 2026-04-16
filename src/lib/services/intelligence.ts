import type { Competitor, IntelCard, MorningBriefItem, WeeklyDigest } from "@/lib/types/intelligence";
import { createClient } from "@/lib/supabase/server";
import { mockMorningBrief, mockWeeklyDigest } from "@/lib/data/mock-intelligence";

export async function getCompetitors(
  tenantSlug: string
): Promise<Competitor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitors")
    .select("*")
    .eq("tenant_id", tenantSlug)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    website: row.website ?? "",
    type: row.type,
    platforms: row.platforms ?? [],
    strengths: row.strengths ?? [],
    weaknesses: row.weaknesses ?? [],
    threatLevel: row.threat_level,
    addedAt: row.created_at,
  }));
}

export async function getIntelFeed(
  tenantSlug: string
): Promise<IntelCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intel_cards")
    .select("*")
    .eq("tenant_id", tenantSlug)
    .order("detected_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    competitorId: row.competitor_id,
    competitorName: row.competitor_name,
    competitorType: row.competitor_type,
    platform: row.platform,
    contentType: row.content_type,
    summary: row.summary,
    postUrl: row.post_url,
    metrics: row.metrics ?? {},
    aiRecommendation: row.ai_recommendation ?? null,
    detectedAt: row.detected_at,
    source: row.source,
  }));
}

export async function getMorningBrief(
  tenantSlug: string
): Promise<MorningBriefItem[]> {
  return mockMorningBrief[tenantSlug] ?? [];
}

export async function getWeeklyDigest(
  tenantSlug: string
): Promise<WeeklyDigest | null> {
  return mockWeeklyDigest[tenantSlug] ?? null;
}
