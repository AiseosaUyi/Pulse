import { describe, it, expect } from "vitest";
import { isOutsideOfficeHours, shouldAiCover } from "@/lib/shared-inbox/office-hours";
import { defaultSharedInboxConfig, type SharedInboxConfig } from "@/lib/shared-inbox/types";

// Schema-only / pure-function tests — no OpenAI calls, no DB. Fixed ISO
// timestamps across real IANA timezones (isOutsideOfficeHours resolves
// wall-clock via Intl the same way lib/cadence/compute.ts's nowInTz does),
// mirroring tests/unit/cadence-compute.test.ts's fixed-date convention.

// 2026-06-16 is a Tuesday (weekday 2), 2026-06-20 is a Saturday (weekday 6).
const TUE = "2026-06-16";
const SAT = "2026-06-20";

function config(overrides: Partial<SharedInboxConfig> = {}): SharedInboxConfig {
  return { ...defaultSharedInboxConfig(), enabled: true, ...overrides };
}

const WEEKDAY_WINDOW = {
  id: "w1",
  label: "Working hours",
  days: [1, 2, 3, 4, 5], // Mon-Fri
  start: "09:00",
  end: "17:00",
};

describe("isOutsideOfficeHours", () => {
  it("is always true when alwaysOn is set, regardless of officeHours", () => {
    const c = config({ alwaysOn: true, officeHours: [WEEKDAY_WINDOW] });
    // Noon on a Tuesday, squarely inside the configured window — alwaysOn overrides it.
    expect(isOutsideOfficeHours(c, `${TUE}T12:00:00Z`)).toBe(true);
  });

  it("is always true when no officeHours windows are configured (a tenant that enables coverage without defining human hours isn't silently inert)", () => {
    const c = config({ officeHours: [] });
    expect(isOutsideOfficeHours(c, `${TUE}T12:00:00Z`)).toBe(true);
  });

  it("is false during a matching window (Africa/Lagos, UTC+1, no DST)", () => {
    const c = config({ timezone: "Africa/Lagos", officeHours: [WEEKDAY_WINDOW] });
    // 12:00 UTC -> 13:00 Lagos, inside 09:00-17:00.
    expect(isOutsideOfficeHours(c, `${TUE}T12:00:00Z`)).toBe(false);
  });

  it("is true after a matching window closes, same day/timezone", () => {
    const c = config({ timezone: "Africa/Lagos", officeHours: [WEEKDAY_WINDOW] });
    // 20:00 UTC -> 21:00 Lagos, past 17:00.
    expect(isOutsideOfficeHours(c, `${TUE}T20:00:00Z`)).toBe(true);
  });

  it("is true before a matching window opens, same day/timezone", () => {
    const c = config({ timezone: "Africa/Lagos", officeHours: [WEEKDAY_WINDOW] });
    // 06:00 UTC -> 07:00 Lagos, before 09:00.
    expect(isOutsideOfficeHours(c, `${TUE}T06:00:00Z`)).toBe(true);
  });

  it("is true on a day not in the window's days array", () => {
    const c = config({ timezone: "Africa/Lagos", officeHours: [WEEKDAY_WINDOW] });
    // Saturday, would otherwise be well inside 09:00-17:00.
    expect(isOutsideOfficeHours(c, `${SAT}T12:00:00Z`)).toBe(true);
  });

  it("resolves a different timezone correctly (America/New_York, UTC-4 in June/EDT)", () => {
    const c = config({ timezone: "America/New_York", officeHours: [WEEKDAY_WINDOW] });
    // 14:00 UTC -> 10:00 New York, inside 09:00-17:00.
    expect(isOutsideOfficeHours(c, `${TUE}T14:00:00Z`)).toBe(false);
    // 22:00 UTC -> 18:00 New York, past 17:00.
    expect(isOutsideOfficeHours(c, `${TUE}T22:00:00Z`)).toBe(true);
  });

  it("treats a window's end as exclusive (message arriving exactly at end-of-window is outside coverage)", () => {
    const c = config({ timezone: "UTC", officeHours: [WEEKDAY_WINDOW] });
    expect(isOutsideOfficeHours(c, `${TUE}T17:00:00Z`)).toBe(true);
    expect(isOutsideOfficeHours(c, `${TUE}T16:59:00Z`)).toBe(false);
    expect(isOutsideOfficeHours(c, `${TUE}T09:00:00Z`)).toBe(false); // start is inclusive
  });

  it("never throws on an invalid timezone — falls back to UTC (same guarantee as nowInTz)", () => {
    const c = config({ timezone: "Not/A_Real_Zone", officeHours: [WEEKDAY_WINDOW] });
    expect(() => isOutsideOfficeHours(c, `${TUE}T12:00:00Z`)).not.toThrow();
    expect(isOutsideOfficeHours(c, `${TUE}T12:00:00Z`)).toBe(false); // 12:00 UTC is inside 09:00-17:00
  });
});

describe("shouldAiCover", () => {
  it("is false when the tenant hasn't opted in, no matter the time", () => {
    const c = config({ enabled: false, alwaysOn: true, officeHours: [] });
    expect(shouldAiCover(c, `${TUE}T12:00:00Z`)).toBe(false);
  });

  it("is true when enabled + alwaysOn, any time", () => {
    const c = config({ enabled: true, alwaysOn: true });
    expect(shouldAiCover(c, `${TUE}T12:00:00Z`)).toBe(true);
  });

  it("is false when enabled but the message arrived during human-covered hours", () => {
    const c = config({ enabled: true, timezone: "Africa/Lagos", officeHours: [WEEKDAY_WINDOW] });
    expect(shouldAiCover(c, `${TUE}T12:00:00Z`)).toBe(false); // 13:00 Lagos, inside hours
  });

  it("is true when enabled and the message arrived outside human-covered hours", () => {
    const c = config({ enabled: true, timezone: "Africa/Lagos", officeHours: [WEEKDAY_WINDOW] });
    expect(shouldAiCover(c, `${TUE}T20:00:00Z`)).toBe(true); // 21:00 Lagos, past hours
  });

  it("evaluates against the message's own received time, not the current wall clock", () => {
    // A timestamp from years in the past still resolves deterministically —
    // shouldAiCover must never read `new Date()` internally.
    const c = config({ enabled: true, timezone: "UTC", officeHours: [WEEKDAY_WINDOW] });
    expect(shouldAiCover(c, "2020-01-01T12:00:00Z")).toBe(false); // 2020-01-01 is a Wednesday, 12:00 inside hours
    expect(shouldAiCover(c, "2020-01-04T12:00:00Z")).toBe(true); // 2020-01-04 is a Saturday
  });
});
