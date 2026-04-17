import type { Competitor, IntelCard, MorningBriefItem, WeeklyDigest } from "@/lib/types/intelligence";
import { createClient } from "@/lib/supabase/server";

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
  const supabase = await createClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("intel_cards")
    .select("id, competitor_name, summary, ai_recommendation, detected_at")
    .eq("tenant_id", tenantSlug)
    .gte("detected_at", sevenDaysAgo)
    .order("detected_at", { ascending: false });

  if (error || !data) return [];

  const scored = data
    .map((row) => {
      const rec = row.ai_recommendation as
        | { impact?: "high" | "medium" | "low"; analysis?: string }
        | null;
      const impact = rec?.impact ?? "low";
      const blurb = rec?.analysis?.trim() || row.summary;
      return {
        summary: `${row.competitor_name}: ${blurb}`,
        intelCardId: row.id as string,
        impact,
      };
    })
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 } as const;
      return rank[b.impact] - rank[a.impact];
    })
    .slice(0, 3);

  return scored;
}

export async function getWeeklyDigest(
  _tenantSlug: string
): Promise<WeeklyDigest | null> {
  // Weekly digest requires an insight/rules engine to synthesize
  // strategic recommendations from intel_cards. Returning null until
  // that engine is designed — the WeeklyDigest component handles this
  // with a "Not enough data" empty state.
  return null;
}
