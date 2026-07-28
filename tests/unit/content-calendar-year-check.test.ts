import { describe, it, expect } from "vitest";
import { findStaleYear } from "@/lib/utils/year-check";

describe("findStaleYear", () => {
  it("flags a year older than the current year", () => {
    expect(findStaleYear("AI Design Innovations for 2023", 2026)).toBe(2023);
    expect(findStaleYear("Vibe coding 2025", 2026)).toBe(2025);
  });

  it("does not flag the current year", () => {
    expect(findStaleYear("The State of AI Design in 2026", 2026)).toBeNull();
  });

  it("does not flag a future year", () => {
    expect(findStaleYear("Predictions for 2027", 2026)).toBeNull();
  });

  it("returns null when no year is present", () => {
    expect(findStaleYear("How I Redesigned My Onboarding Flow", 2026)).toBeNull();
  });

  it("flags the stale year even when a current year is also present", () => {
    expect(findStaleYear("From 2023 to 2026: How My Workflow Changed", 2026)).toBe(2023);
  });
});
