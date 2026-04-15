import type { Competitor, IntelCard, MorningBriefItem, WeeklyDigest } from "@/lib/types/intelligence";
import { supabase } from "@/lib/supabase/client";
import { mockMorningBrief, mockWeeklyDigest } from "@/lib/data/mock-intelligence";

export async function getCompetitors(
  tenantSlug: string
): Promise<Competitor[]> {
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
  // Phase 2: Generate from top 3 intel cards by impact in last 24h
  // For now: use mock data since morning brief is an aggregation
  return mockMorningBrief[tenantSlug] ?? [];
}

export async function getWeeklyDigest(
  tenantSlug: string
): Promise<WeeklyDigest | null> {
  // Phase 2: Generate via Vercel Cron + cache
  // For now: use mock data since digest is an AI-generated aggregation
  return mockWeeklyDigest[tenantSlug] ?? null;
}
