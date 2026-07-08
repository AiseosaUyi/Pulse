import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/scrape/google-serp", () => ({
  scrapeGoogleSerp: vi.fn(),
}));

const { fetchTrendCandidates } = await import("@/lib/scrape/trend-pull");
const { scrapeGoogleSerp } = await import("@/lib/scrape/google-serp");

describe("fetchTrendCandidates", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("merges Hacker News and Serper results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          hits: [{ title: "New AI model released", url: "https://example.com/a", points: 120, objectID: "1" }],
        }),
      })
    );
    vi.mocked(scrapeGoogleSerp).mockResolvedValue([
      { position: 1, url: "https://news.example.com/b", domain: "news.example.com", title: "AI news today", snippet: "..." },
    ]);

    const results = await fetchTrendCandidates("AI");
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.source === "hn")).toBe(true);
    expect(results.some((r) => r.source === "serper")).toBe(true);
  });

  it("returns an empty array (not a throw) when both sources fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    vi.mocked(scrapeGoogleSerp).mockRejectedValue(new Error("serper down"));

    const results = await fetchTrendCandidates("AI");
    expect(results).toEqual([]);
  });

  it("still returns Serper results when Hacker News fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    vi.mocked(scrapeGoogleSerp).mockResolvedValue([
      { position: 1, url: "https://news.example.com/b", domain: "news.example.com", title: "AI news today", snippet: "..." },
    ]);

    const results = await fetchTrendCandidates("AI");
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("serper");
  });
});
