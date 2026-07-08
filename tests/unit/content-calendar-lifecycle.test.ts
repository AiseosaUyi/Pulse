import { describe, it, expect } from "vitest";
import { isSlotStale, STALE_AFTER_DAYS } from "@/lib/types/content-calendar";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("isSlotStale", () => {
  it("is false for a freshly generated assigned slot", () => {
    expect(isSlotStale({ generatedAt: daysAgo(0), status: "assigned" })).toBe(false);
  });

  it("is false just under the staleness window", () => {
    expect(
      isSlotStale({ generatedAt: daysAgo(STALE_AFTER_DAYS - 1), status: "assigned" })
    ).toBe(false);
  });

  it("is true once past the staleness window for an unposted slot", () => {
    expect(
      isSlotStale({ generatedAt: daysAgo(STALE_AFTER_DAYS + 1), status: "assigned" })
    ).toBe(true);
    expect(
      isSlotStale({ generatedAt: daysAgo(STALE_AFTER_DAYS + 1), status: "in_progress" })
    ).toBe(true);
  });

  it("is never true for a posted slot, however old", () => {
    expect(isSlotStale({ generatedAt: daysAgo(365), status: "posted" })).toBe(false);
  });

  it("is never true for a skipped slot, however old", () => {
    expect(isSlotStale({ generatedAt: daysAgo(365), status: "skipped" })).toBe(false);
  });
});
