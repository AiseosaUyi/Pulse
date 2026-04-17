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
