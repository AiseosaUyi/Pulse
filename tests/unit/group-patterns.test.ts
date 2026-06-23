import { describe, it, expect } from "vitest";
import { groupPatterns } from "@/lib/ai/group-patterns";
import type { IntelCard } from "@/lib/types/intelligence";

// platform/contentType are accepted as plain strings (cast inside) so callers
// can pass loop variables; the rest stays a Partial of the remaining fields.
// We destructure them out so the trailing spread can't re-declare them.
function card(
  overrides: {
    platform: string;
    contentType: string;
    metrics?: Partial<IntelCard["metrics"]>;
  } & Partial<Omit<IntelCard, "platform" | "contentType" | "metrics">>
): IntelCard {
  const { platform, contentType, metrics, ...rest } = overrides;
  return {
    id: crypto.randomUUID(),
    tenantId: "gruve",
    competitorId: "c1",
    competitorName: "Test",
    competitorType: "direct",
    platform: platform as IntelCard["platform"],
    contentType: contentType as IntelCard["contentType"],
    summary: "test",
    metrics: {
      engagement: 100,
      engagementRate: 3.0,
      vsAverage: 1.0,
      ...metrics,
    },
    aiRecommendation: null,
    detectedAt: new Date().toISOString(),
    source: "manual",
    ...rest,
  };
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
