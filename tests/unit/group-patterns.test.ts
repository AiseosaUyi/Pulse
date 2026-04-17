import { describe, it, expect } from "vitest";
import { groupPatterns } from "@/lib/ai/group-patterns";
import type { IntelCard } from "@/lib/types/intelligence";

function card(
  overrides: Partial<IntelCard> & { platform: string; contentType: string }
): IntelCard {
  return {
    id: crypto.randomUUID(),
    tenantId: "gruve",
    competitorId: "c1",
    competitorName: "Test",
    competitorType: "direct",
    platform: overrides.platform as IntelCard["platform"],
    contentType: overrides.contentType as IntelCard["contentType"],
    summary: "test",
    metrics: {
      engagement: 100,
      engagementRate: 3.0,
      vsAverage: 1.0,
      ...overrides.metrics,
    },
    aiRecommendation: null,
    detectedAt: new Date().toISOString(),
    source: "manual",
    ...overrides,
  } as IntelCard;
}

describe("groupPatterns", () => {
  it("returns empty array for empty input", () => {
    expect(groupPatterns([])).toEqual([]);
  });

  it("filters out clusters with fewer than 2 cards", () => {
    const cards = [card({ platform: "instagram", contentType: "reel" })];
    expect(groupPatterns(cards)).toEqual([]);
  });

  it("groups by platform + contentType", () => {
    const cards = [
      card({ platform: "instagram", contentType: "reel", metrics: { engagement: 100, engagementRate: 5, vsAverage: 2 } }),
      card({ platform: "instagram", contentType: "reel", metrics: { engagement: 100, engagementRate: 6, vsAverage: 3 } }),
      card({ platform: "tiktok", contentType: "reel", metrics: { engagement: 100, engagementRate: 8, vsAverage: 4 } }),
      card({ platform: "tiktok", contentType: "reel", metrics: { engagement: 100, engagementRate: 7, vsAverage: 5 } }),
    ];
    const clusters = groupPatterns(cards);
    expect(clusters).toHaveLength(2);
    // TikTok has higher avgVsAverage → first
    expect(clusters[0].key).toBe("tiktok|reel");
    expect(clusters[1].key).toBe("instagram|reel");
  });

  it("treats null vsAverage as baseline 1.0", () => {
    const cards = [
      card({ platform: "instagram", contentType: "reel", metrics: { engagement: 100, engagementRate: 5, vsAverage: null } }),
      card({ platform: "instagram", contentType: "reel", metrics: { engagement: 100, engagementRate: 5, vsAverage: null } }),
    ];
    const clusters = groupPatterns(cards);
    expect(clusters[0].avgVsAverage).toBe(1.0);
  });

  it("caps at top 3 clusters", () => {
    const cards: IntelCard[] = [];
    for (const platform of ["instagram", "tiktok", "twitter", "linkedin"]) {
      cards.push(card({ platform, contentType: "reel" }));
      cards.push(card({ platform, contentType: "reel" }));
    }
    expect(groupPatterns(cards)).toHaveLength(3);
  });
});
