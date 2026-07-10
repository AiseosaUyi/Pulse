import type { Competitor, IntelCard, MorningBriefItem, WeeklyDigest } from "@/lib/types/intelligence";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCompetitors(
  tenantSlug: string
): Promise<Competitor[]> {
  const supabase = await createClient();
  return listCompetitors(supabase, tenantSlug);
}

function competitorRowTo(row: Record<string, unknown>): Competitor {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    website: (row.website as string) ?? "",
    type: row.type as Competitor["type"],
    platforms: (row.platforms as Competitor["platforms"]) ?? [],
    strengths: (row.strengths as string[]) ?? [],
    weaknesses: (row.weaknesses as string[]) ?? [],
    threatLevel: row.threat_level as Competitor["threatLevel"],
    addedAt: row.created_at as string,
  };
}

/** Client-injected twin of getCompetitors() — shared by the SSR page
 * (via getCompetitors' own createClient() call) and /api/v1 + MCP. */
export async function listCompetitors(
  client: SupabaseClient,
  tenantSlug: string
): Promise<Competitor[]> {
  const { data, error } = await client
    .from("competitors")
    .select("*")
    .eq("tenant_id", tenantSlug)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(competitorRowTo);
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
  return data.map(intelCardRowTo);
}

function intelCardRowTo(row: Record<string, unknown>): IntelCard {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    competitorId: row.competitor_id as string,
    competitorName: row.competitor_name as string,
    competitorType: row.competitor_type as IntelCard["competitorType"],
    platform: row.platform as IntelCard["platform"],
    contentType: row.content_type as IntelCard["contentType"],
    summary: row.summary as string,
    postUrl: (row.post_url as string | undefined) ?? undefined,
    metrics: (row.metrics as IntelCard["metrics"]) ?? { engagement: 0, engagementRate: 0, vsAverage: null },
    aiRecommendation: (row.ai_recommendation as IntelCard["aiRecommendation"]) ?? null,
    detectedAt: row.detected_at as string,
    source: row.source as IntelCard["source"],
  };
}

/** Client-injected, filtered + paginated twin of getIntelFeed() for
 * /api/v1 + MCP — the SSR page's getIntelFeed() is left untouched
 * (no filter/pagination needs there). */
export async function listIntelFeed(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { contentType?: string; since?: string; limit?: number; offset?: number } = {}
): Promise<{ data: IntelCard[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;

  let query = client
    .from("intel_cards")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantSlug)
    .order("detected_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.contentType) query = query.eq("content_type", filter.contentType);
  if (filter.since) query = query.gte("detected_at", filter.since);

  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };
  return { data: data.map(intelCardRowTo), total: count ?? 0 };
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
