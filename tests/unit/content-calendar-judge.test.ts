import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  Output: { object: (opts: unknown) => opts },
}));

vi.mock("@/lib/ai/gateway", () => ({
  getModel: () => "mock-model",
  getModelId: () => "openai/gpt-4o-mini",
  estimateCostUsd: () => 0,
  logAiCall: vi.fn(),
}));

const { judgeCandidates } = await import("@/lib/ai/content-calendar-judge");

describe("judgeCandidates", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("returns empty array without calling the model when there are no candidates", async () => {
    const result = await judgeCandidates({
      tenantSlug: "t1",
      niches: ["Design"],
      currentYear: 2026,
      candidates: [],
      contextTitles: [],
    });
    expect(result).toEqual([]);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("passes only when onLane, individualFit, and templateOk are all true", async () => {
    generateTextMock.mockResolvedValue({
      output: {
        verdicts: [
          { index: 0, onLane: true, individualFit: true, templateOk: true, reason: "" },
          { index: 1, onLane: true, individualFit: false, templateOk: true, reason: "reads like company marketing" },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const result = await judgeCandidates({
      tenantSlug: "t1",
      niches: ["Design"],
      currentYear: 2026,
      candidates: [
        { index: 0, title: "How I Redesigned My Onboarding Flow", pillar: "Design", format: "how_to" },
        { index: 1, title: "Our Team Launches New Design Tool", pillar: "Design", format: "news_reaction" },
      ],
      contextTitles: [],
    });

    expect(result.find((v) => v.index === 0)?.pass).toBe(true);
    expect(result.find((v) => v.index === 1)?.pass).toBe(false);
    expect(result.find((v) => v.index === 1)?.reason).toContain("company marketing");
  });

  it("fails open (accepts) when the model call throws", async () => {
    generateTextMock.mockRejectedValue(new Error("network error"));

    const result = await judgeCandidates({
      tenantSlug: "t1",
      niches: ["Design"],
      currentYear: 2026,
      candidates: [{ index: 0, title: "Some Topic", pillar: "Design", format: "hot_take" }],
      contextTitles: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].pass).toBe(true);
  });

  it("fails a candidate closed if the model omits a verdict for it", async () => {
    generateTextMock.mockResolvedValue({
      output: { verdicts: [] },
      usage: { inputTokens: 5, outputTokens: 5 },
    });

    const result = await judgeCandidates({
      tenantSlug: "t1",
      niches: ["Design"],
      currentYear: 2026,
      candidates: [{ index: 0, title: "Some Topic", pillar: "Design", format: "hot_take" }],
      contextTitles: [],
    });

    expect(result[0].pass).toBe(false);
  });
});
