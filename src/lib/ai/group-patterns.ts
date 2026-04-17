import type { IntelCard } from "@/lib/types/intelligence";

export interface PatternCluster {
  name: string;
  key: string;
  cards: IntelCard[];
  avgVsAverage: number;
  avgEngagementRate: number;
}

export function groupPatterns(cards: IntelCard[]): PatternCluster[] {
  const buckets = new Map<string, IntelCard[]>();
  for (const card of cards) {
    const key = `${card.platform}|${card.contentType}`;
    const list = buckets.get(key) ?? [];
    list.push(card);
    buckets.set(key, list);
  }

  const clusters: PatternCluster[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const [platform, contentType] = key.split("|");
    const avgVsAverage =
      list.reduce((sum, c) => sum + (c.metrics.vsAverage ?? 1), 0) / list.length;
    const avgEngagementRate =
      list.reduce((sum, c) => sum + (c.metrics.engagementRate ?? 0), 0) / list.length;
    clusters.push({
      name: `${platform} ${contentType}`,
      key,
      cards: list,
      avgVsAverage,
      avgEngagementRate,
    });
  }

  clusters.sort((a, b) => {
    if (b.avgVsAverage !== a.avgVsAverage) return b.avgVsAverage - a.avgVsAverage;
    return b.avgEngagementRate - a.avgEngagementRate;
  });

  return clusters.slice(0, 3);
}
