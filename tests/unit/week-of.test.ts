import { describe, it, expect } from "vitest";
import { startOfWeekSaturday, weekOfIso } from "@/lib/util/week-of";

describe("startOfWeekSaturday", () => {
  it("Saturday returns itself at 00:00 UTC", () => {
    const sat = new Date("2026-04-18T09:00:00Z");
    expect(startOfWeekSaturday(sat).toISOString()).toBe("2026-04-18T00:00:00.000Z");
  });

  it("Sunday (same week) returns prior Saturday", () => {
    const sun = new Date("2026-04-19T23:59:00Z");
    expect(startOfWeekSaturday(sun).toISOString()).toBe("2026-04-18T00:00:00.000Z");
  });

  it("Friday returns prior Saturday", () => {
    const fri = new Date("2026-04-24T12:00:00Z");
    expect(startOfWeekSaturday(fri).toISOString()).toBe("2026-04-18T00:00:00.000Z");
  });

  it("Next Saturday starts a new week", () => {
    const nextSat = new Date("2026-04-25T00:00:00Z");
    expect(startOfWeekSaturday(nextSat).toISOString()).toBe("2026-04-25T00:00:00.000Z");
  });

  it("weekOfIso is stable within a week", () => {
    const sat = weekOfIso(new Date("2026-04-18T09:00:00Z"));
    const sun = weekOfIso(new Date("2026-04-19T23:59:00Z"));
    const fri = weekOfIso(new Date("2026-04-24T12:00:00Z"));
    expect(sat).toBe(sun);
    expect(sat).toBe(fri);
  });
});
