import type {
  SEOMetric,
  KeywordRanking,
  KeywordDifficulty,
  KeywordGroup,
  TopicalCluster,
  ContentScoreBreakdown,
} from "@/lib/types/seo";
import {
  mockKeywordGroups,
  mockTopicalClusters,
  mockContentScores,
} from "@/lib/data/mock-seo";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

function keywordRankingRowTo(row: Record<string, unknown>): KeywordRanking {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    keyword: row.keyword as string,
    url: (row.url as string) ?? null,
    position: (row.position as number) ?? null,
    previousPosition: (row.previous_position as number) ?? null,
    positionSource: (row.position_source as KeywordRanking["positionSource"]) ?? null,
    volume: row.volume as number,
    difficulty: row.difficulty as KeywordDifficulty,
    lastChecked: (row.last_checked as string) ?? null,
    notes: (row.notes as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/** Client-injected, offset-paginated twin of getKeywordRankings() for
 * /api/v1 + MCP — getKeywordRankings() itself is left untouched (its 6
 * existing callers all want the full unpaginated list). */
export async function listKeywordRankingsApi(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { limit?: number; offset?: number } = {}
): Promise<{ data: KeywordRanking[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  const { data, error, count } = await client
    .from("keyword_rankings")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .order("volume", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error || !data) return { data: [], total: 0 };
  return { data: data.map(keywordRankingRowTo), total: count ?? 0 };
}

export interface SeoRecommendation {
  id: string;
  tenantSlug: string;
  blogPostId: string | null;
  slug: string | null;
  type: string;
  payload: Record<string, unknown>;
  score: number | null;
  status: string;
  surfacedAt: string;
  appliedAt: string | null;
  dismissedAt: string | null;
  snoozedUntil: string | null;
  notes: string | null;
}

function seoRecommendationRowTo(row: Record<string, unknown>): SeoRecommendation {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    blogPostId: (row.blog_post_id as string) ?? null,
    slug: (row.slug as string) ?? null,
    type: row.type as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    score: (row.score as number) ?? null,
    status: row.status as string,
    surfacedAt: row.surfaced_at as string,
    appliedAt: (row.applied_at as string) ?? null,
    dismissedAt: (row.dismissed_at as string) ?? null,
    snoozedUntil: (row.snoozed_until as string) ?? null,
    notes: (row.notes as string) ?? null,
  };
}

/** No SSR read function exists for seo_recommendations at all (only
 * session-gated write actions in actions/seo-recommendations.ts) — this
 * is new, not a refactor. Defaults to status='surfaced' (the "open
 * recommendations" the composite index `idx_seo_recs_tenant_status_score`
 * is built for), ordered by score desc. */
export async function listSeoRecommendations(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ data: SeoRecommendation[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  const { data, error, count } = await client
    .from("seo_recommendations")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .eq("status", filter.status ?? "surfaced")
    .order("score", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error || !data) return { data: [], total: 0 };
  return { data: data.map(seoRecommendationRowTo), total: count ?? 0 };
}

export interface TopicalMapApi {
  clustering: unknown;
  generatedAt: string;
  drafts: Record<string, string>;
}

/** Client-injected twin of getLatestTopicalMap() (actions/topical-map.ts)
 * — that file is `"use server"`, so every export must have serializable
 * params; a SupabaseClient can't be one. This duplicates its exact
 * (LLM-free) read logic rather than reshaping the action. */
export async function getTopicalMapApi(
  client: SupabaseClient,
  tenantSlug: string
): Promise<TopicalMapApi | null> {
  const { data: map } = await client
    .from("topical_maps")
    .select("clustering, generated_at")
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!map) return null;

  const { data: drafts } = await client
    .from("topical_map_drafts")
    .select("cluster_name, article_title, blog_post_id")
    .eq("tenant_slug", tenantSlug);

  const draftMap: Record<string, string> = {};
  for (const d of drafts ?? []) {
    if (d.blog_post_id) {
      draftMap[`${d.cluster_name}::${d.article_title}`] = d.blog_post_id;
    }
  }

  return {
    clustering: map.clustering,
    generatedAt: map.generated_at as string,
    drafts: draftMap,
  };
}

export async function getKeywordRankings(tenantSlug: string): Promise<KeywordRanking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keyword_rankings")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("volume", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    keyword: row.keyword,
    url: row.url ?? null,
    position: row.position ?? null,
    previousPosition: row.previous_position ?? null,
    positionSource: row.position_source ?? null,
    volume: row.volume,
    difficulty: row.difficulty as KeywordDifficulty,
    lastChecked: row.last_checked ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  }));
}

export function deriveSEOMetrics(keywords: KeywordRanking[]): SEOMetric[] {
  const ranked = keywords.filter((k) => k.position !== null);
  const total = keywords.length;
  const top3 = ranked.filter((k) => (k.position ?? 999) <= 3).length;
  const top10 = ranked.filter((k) => (k.position ?? 999) <= 10).length;

  const positions = ranked.map((k) => k.position as number);
  const avgPos = positions.length ? positions.reduce((s, p) => s + p, 0) / positions.length : 0;

  const prevRanked = keywords.filter((k) => k.previousPosition !== null);
  const prevPositions = prevRanked.map((k) => k.previousPosition as number);
  const prevAvgPos = prevPositions.length
    ? prevPositions.reduce((s, p) => s + p, 0) / prevPositions.length
    : 0;

  const rising = keywords.filter(
    (k) => k.position !== null && k.previousPosition !== null && k.previousPosition > k.position
  ).length;
  const declining = keywords.filter(
    (k) => k.position !== null && k.previousPosition !== null && k.previousPosition < k.position
  ).length;

  const prevTop3 = prevRanked.filter((k) => (k.previousPosition ?? 999) <= 3).length;
  const top3Change = top3 - prevTop3;

  function fmt(n: number, digits = 1): string {
    return Number.isFinite(n) && n > 0 ? n.toFixed(digits) : "—";
  }

  const avgChange = avgPos && prevAvgPos ? prevAvgPos - avgPos : 0;

  return [
    {
      label: "Tracked Keywords",
      value: total.toString(),
      change: "—",
      direction: "stable",
    },
    {
      label: "Avg. Position",
      value: fmt(avgPos),
      change: avgChange === 0 ? "—" : `${avgChange > 0 ? "↑" : "↓"}${Math.abs(avgChange).toFixed(1)}`,
      direction: avgChange > 0 ? "up" : avgChange < 0 ? "down" : "stable",
    },
    {
      label: "Top 3 Keywords",
      value: top3.toString(),
      change: top3Change === 0 ? "—" : `${top3Change > 0 ? "+" : ""}${top3Change}`,
      direction: top3Change > 0 ? "up" : top3Change < 0 ? "down" : "stable",
    },
    {
      label: "Top 10 Keywords",
      value: top10.toString(),
      change: "—",
      direction: "stable",
    },
    {
      label: "Rising",
      value: rising.toString(),
      change: "—",
      direction: rising > 0 ? "up" : "stable",
    },
    {
      label: "Declining",
      value: declining.toString(),
      change: "—",
      direction: declining > 0 ? "down" : "stable",
    },
  ];
}

export async function getSEOMetrics(tenantSlug: string): Promise<SEOMetric[]> {
  const keywords = await getKeywordRankings(tenantSlug);
  return deriveSEOMetrics(keywords);
}

// ─── Still-mock helpers ───────────────────────────────────────
// Keyword clustering UI + content score breakdown aren't backed by
// real tables yet. Kept as mock fallbacks to avoid breaking the
// dashboard pages that consume them. Migrate when their consuming
// features get real data.

export async function getKeywordGroups(tenantSlug: string): Promise<KeywordGroup[]> {
  return mockKeywordGroups[tenantSlug] ?? mockKeywordGroups.gruve;
}

export async function getTopicalClusters(tenantSlug: string): Promise<TopicalCluster[]> {
  return mockTopicalClusters[tenantSlug] ?? mockTopicalClusters.gruve;
}

export async function getContentScore(postId: string): Promise<ContentScoreBreakdown | null> {
  return mockContentScores[postId] ?? null;
}
