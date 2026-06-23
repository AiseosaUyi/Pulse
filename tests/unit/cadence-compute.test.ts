import { describe, it, expect } from "vitest";
import { computeTracker, nowInTz, timeToMinutes, type NowParts } from "@/lib/cadence/compute";
import type { CadenceConfig, PostLogRow } from "@/lib/cadence/types";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function config(overrides: Partial<CadenceConfig> = {}): CadenceConfig {
  return {
    enabled: true,
    timezone: "UTC",
    targets: { x: 3, linkedin: 1 },
    windows: [
      { id: "xm", label: "Morning", platform: "x", time: "09:00", days: ALL_DAYS },
      { id: "xd", label: "Midday", platform: "x", time: "13:00", days: ALL_DAYS },
      { id: "xe", label: "Evening", platform: "x", time: "18:00", days: ALL_DAYS },
      { id: "lm", label: "Mid-morning", platform: "linkedin", time: "10:00", days: ALL_DAYS },
    ],
    ...overrides,
  };
}

// Tuesday 2026-06-16, 14:00 local (weekday 2).
const NOON: NowParts = { date: "2026-06-16", minutes: 14 * 60, weekday: 2 };

const x = (t: ReturnType<typeof computeTracker>) => t.platforms.find((p) => p.platform === "x")!;
const li = (t: ReturnType<typeof computeTracker>) => t.platforms.find((p) => p.platform === "linkedin")!;

describe("timeToMinutes", () => {
  it("parses HH:mm", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("18:30")).toBe(1110);
  });
});

describe("computeTracker — per-platform split", () => {
  it("returns a tracker per platform with target + windows", () => {
    const t = computeTracker(config(), [], NOON);
    expect(t.platforms.map((p) => p.platform).sort()).toEqual(["linkedin", "x"]);
    expect(x(t).target).toBe(3);
    expect(li(t).target).toBe(1);
    expect(x(t).windows).toHaveLength(3);
    expect(li(t).windows).toHaveLength(1);
  });

  it("computes window status independently per platform", () => {
    const t = computeTracker(config(), [], NOON);
    const xByetId = Object.fromEntries(x(t).windows.map((w) => [w.id, w.status]));
    expect(xByetId.xm).toBe("missed"); // 09:00 passed
    expect(xByetId.xd).toBe("now"); // 13:00 latest due
    expect(xByetId.xe).toBe("upcoming"); // 18:00 future
    // LinkedIn 10:00 passed and is the only one → now
    expect(li(t).windows[0].status).toBe("now");
  });

  it("counts posts only toward their own platform", () => {
    const rows: PostLogRow[] = [
      { posted_date: "2026-06-16", window_id: "xm", platform: "x" },
      { posted_date: "2026-06-16", window_id: null, platform: "x" },
      { posted_date: "2026-06-16", window_id: "lm", platform: "linkedin" },
    ];
    const t = computeTracker(config(), rows, NOON);
    expect(x(t).posted).toBe(2);
    expect(li(t).posted).toBe(1);
    expect(x(t).windows.find((w) => w.id === "xm")?.status).toBe("done");
    expect(li(t).windows[0].status).toBe("done");
  });

  it("marks a platform behind until its target is met; overall behind = any platform behind", () => {
    const rows: PostLogRow[] = [{ posted_date: "2026-06-16", window_id: "lm", platform: "linkedin" }];
    const t = computeTracker(config(), rows, NOON);
    expect(li(t).behind).toBe(false); // 1/1
    expect(x(t).behind).toBe(true); // 0/3
    expect(t.behind).toBe(true);
  });

  it("is not behind once every platform hits target", () => {
    const rows: PostLogRow[] = [
      ...Array.from({ length: 3 }, () => ({ posted_date: "2026-06-16", window_id: null, platform: "x" })),
      { posted_date: "2026-06-16", window_id: null, platform: "linkedin" },
    ];
    const t = computeTracker(config(), rows, NOON);
    expect(t.behind).toBe(false);
  });

  it("drops a platform with no target and no windows", () => {
    const t = computeTracker(
      config({ targets: { x: 3, linkedin: 0 }, windows: config().windows.filter((w) => w.platform === "x") }),
      [],
      NOON
    );
    expect(t.platforms.map((p) => p.platform)).toEqual(["x"]);
  });
});

describe("computeTracker — 7-day strip", () => {
  it("builds 7 cells ending today, counts all platforms, flags active days", () => {
    const rows: PostLogRow[] = [
      { posted_date: "2026-06-16", window_id: "xm", platform: "x" },
      { posted_date: "2026-06-16", window_id: "lm", platform: "linkedin" },
      { posted_date: "2026-06-14", window_id: null, platform: "x" },
    ];
    const t = computeTracker(config(), rows, NOON);
    expect(t.week).toHaveLength(7);
    expect(t.week[6].isToday).toBe(true);
    expect(t.week[6].date).toBe("2026-06-16");
    expect(t.week[6].count).toBe(2);
    expect(t.daysActiveThisWeek).toBe(2);
  });
});

describe("nowInTz", () => {
  it("resolves wall-clock date/weekday/minutes for a zone (DST-correct via Intl)", () => {
    const parts = nowInTz("America/Los_Angeles", new Date("2026-06-16T23:30:00Z"));
    expect(parts.date).toBe("2026-06-16");
    expect(parts.weekday).toBe(2);
    expect(parts.minutes).toBe(16 * 60 + 30);
  });

  it("rolls to the next local day across the UTC midnight boundary", () => {
    const parts = nowInTz("Africa/Lagos", new Date("2026-06-17T01:30:00Z"));
    expect(parts.date).toBe("2026-06-17");
    expect(parts.minutes).toBe(2 * 60 + 30);
  });

  it("falls back to UTC for an invalid timezone", () => {
    const parts = nowInTz("Not/AZone", new Date("2026-06-16T12:00:00Z"));
    expect(parts.date).toBe("2026-06-16");
    expect(parts.minutes).toBe(12 * 60);
  });
});
