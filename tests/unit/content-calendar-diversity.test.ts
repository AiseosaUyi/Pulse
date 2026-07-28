import { describe, it, expect } from "vitest";
import { buildPillarAssignments } from "@/lib/content-calendar/pillar-rotation";
import { isNearDuplicateTitle, findNearDuplicate, titleSimilarity } from "@/lib/utils/text-similarity";

describe("buildPillarAssignments", () => {
  it("round-robins so every pillar appears at least once when n >= pillar count", () => {
    const niches = ["AI-native design", "vibe coding & AI prototyping", "product & tool reviews", "design takes & AI slop"];
    const assignments = buildPillarAssignments(niches, 10);
    for (const niche of niches) {
      expect(assignments).toContain(niche);
    }
  });

  it("distributes evenly, not front-loaded onto the first pillar", () => {
    const niches = ["A", "B", "C", "D"];
    const assignments = buildPillarAssignments(niches, 8);
    const counts = niches.map((n) => assignments.filter((a) => a === n).length);
    expect(counts).toEqual([2, 2, 2, 2]);
  });

  it("returns empty for zero pillars", () => {
    expect(buildPillarAssignments([], 5)).toEqual([]);
  });
});

describe("title similarity / near-duplicate detection", () => {
  it("flags an exact rephrase as a near-duplicate", () => {
    const a = "AI-Native Product Teams in 2026: The New Baseline";
    const b = "AI Native Product Teams: The New Baseline for 2026";
    expect(isNearDuplicateTitle(a, b)).toBe(true);
  });

  it("does not flag genuinely distinct topics from different pillars", () => {
    const a = "AI-Native Product Teams in 2026: The New Baseline";
    const b = "I Tried Vibe Coding a Full App in One Weekend";
    expect(isNearDuplicateTitle(a, b)).toBe(false);
  });

  it("findNearDuplicate returns the matching existing title", () => {
    const existing = ["The Evolution of AI-Native Design Teams", "Why Every Startup Needs a Design System"];
    const dup = findNearDuplicate("The Evolution of AI Native Design Teams in 2026", existing);
    expect(dup).toBe("The Evolution of AI-Native Design Teams");
  });

  it("similarity score is symmetric", () => {
    const a = "5 Tools Every Solo Founder Should Review";
    const b = "5 Tools Every Solo Founder Should Try";
    expect(titleSimilarity(a, b)).toBeCloseTo(titleSimilarity(b, a), 5);
  });
});
