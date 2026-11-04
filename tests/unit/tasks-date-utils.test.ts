import { describe, it, expect } from "vitest";
import {
  getTenantToday,
  getTenantTime,
  getIsoDueAt,
  getIsoWeekday,
  isTaskScheduledForDate,
  addDays,
  getDatesInRange,
  calculateStreak,
} from "@/lib/tasks/date-utils";

describe("tasks date-utils", () => {
  it("computes tenant today and time correctly", () => {
    const fixedUtc = new Date("2026-11-04T12:00:00Z");
    const lagosToday = getTenantToday("Africa/Lagos", fixedUtc);
    expect(lagosToday).toBe("2026-11-04");

    const lagosTime = getTenantTime("Africa/Lagos", fixedUtc);
    // Africa/Lagos is UTC+1
    expect(lagosTime).toBe("13:00:00");
  });

  it("computes ISO due_at in Africa/Lagos timezone", () => {
    // 2026-11-04 18:00:00 in Lagos (UTC+1) is 2026-11-04T17:00:00.000Z
    const dueAt = getIsoDueAt("2026-11-04", "18:00", "Africa/Lagos");
    expect(dueAt).toBe("2026-11-04T17:00:00.000Z");

    // Default to 23:59:59
    const eod = getIsoDueAt("2026-11-04", null, "Africa/Lagos");
    expect(eod).toBe("2026-11-04T22:59:59.000Z");
  });

  it("calculates ISO weekday (1=Mon..7=Sun)", () => {
    expect(getIsoWeekday("2026-11-02")).toBe(1); // Monday
    expect(getIsoWeekday("2026-11-03")).toBe(2); // Tuesday
    expect(getIsoWeekday("2026-11-04")).toBe(3); // Wednesday
    expect(getIsoWeekday("2026-11-05")).toBe(4); // Thursday
    expect(getIsoWeekday("2026-11-06")).toBe(5); // Friday
    expect(getIsoWeekday("2026-11-07")).toBe(6); // Saturday
    expect(getIsoWeekday("2026-11-08")).toBe(7); // Sunday
  });

  it("checks task schedule recurrence", () => {
    // One off
    expect(
      isTaskScheduledForDate(
        { kind: "one_off", startDate: "2026-11-01", dueDate: "2026-11-05" },
        "2026-11-05"
      )
    ).toBe(true);
    expect(
      isTaskScheduledForDate(
        { kind: "one_off", startDate: "2026-11-01", dueDate: "2026-11-05" },
        "2026-11-06"
      )
    ).toBe(false);

    // Daily
    expect(
      isTaskScheduledForDate(
        { kind: "recurring", startDate: "2026-11-01", recurrence: "daily" },
        "2026-11-04"
      )
    ).toBe(true);
    expect(
      isTaskScheduledForDate(
        { kind: "recurring", startDate: "2026-11-05", recurrence: "daily" },
        "2026-11-04"
      )
    ).toBe(false);

    // Weekdays
    expect(
      isTaskScheduledForDate(
        { kind: "recurring", startDate: "2026-11-01", recurrence: "weekdays" },
        "2026-11-06" // Friday
      )
    ).toBe(true);
    expect(
      isTaskScheduledForDate(
        { kind: "recurring", startDate: "2026-11-01", recurrence: "weekdays" },
        "2026-11-07" // Saturday
      )
    ).toBe(false);

    // Weekly specific days (Monday=1, Thursday=4)
    expect(
      isTaskScheduledForDate(
        {
          kind: "recurring",
          startDate: "2026-11-01",
          recurrence: "weekly",
          recurrenceDays: [1, 4],
        },
        "2026-11-02" // Mon
      )
    ).toBe(true);
    expect(
      isTaskScheduledForDate(
        {
          kind: "recurring",
          startDate: "2026-11-01",
          recurrence: "weekly",
          recurrenceDays: [1, 4],
        },
        "2026-11-03" // Tue
      )
    ).toBe(false);
    expect(
      isTaskScheduledForDate(
        {
          kind: "recurring",
          startDate: "2026-11-01",
          recurrence: "weekly",
          recurrenceDays: [1, 4],
        },
        "2026-11-05" // Thu
      )
    ).toBe(true);

    // Monthly day N
    expect(
      isTaskScheduledForDate(
        {
          kind: "recurring",
          startDate: "2026-11-01",
          recurrence: "monthly",
          recurrenceMonthDay: 15,
        },
        "2026-11-15"
      )
    ).toBe(true);
    expect(
      isTaskScheduledForDate(
        {
          kind: "recurring",
          startDate: "2026-11-01",
          recurrence: "monthly",
          recurrenceMonthDay: 15,
        },
        "2026-11-14"
      )
    ).toBe(false);
  });

  it("handles date math and ranges correctly", () => {
    expect(addDays("2026-11-04", 3)).toBe("2026-11-07");
    expect(addDays("2026-11-04", -1)).toBe("2026-11-03");

    const range = getDatesInRange("2026-11-01", "2026-11-03");
    expect(range).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("calculates streaks accurately according to spec rules", () => {
    const today = "2026-11-04";

    // Scenario 1: Done today + Done yesterday + Done day before = streak 3
    const occs1 = [
      { occursOn: "2026-11-02", status: "done" as const },
      { occursOn: "2026-11-03", status: "done" as const },
      { occursOn: "2026-11-04", status: "done" as const },
    ];
    expect(calculateStreak(occs1, today)).toEqual({ currentStreak: 3, longestStreak: 3 });

    // Scenario 2: Today is pending, but yesterday and day before are done = streak 2 (does not break)
    const occs2 = [
      { occursOn: "2026-11-02", status: "done" as const },
      { occursOn: "2026-11-03", status: "done" as const },
      { occursOn: "2026-11-04", status: "pending" as const },
    ];
    expect(calculateStreak(occs2, today)).toEqual({ currentStreak: 2, longestStreak: 2 });

    // Scenario 3: Yesterday was missed, today is pending = streak 0
    const occs3 = [
      { occursOn: "2026-11-02", status: "done" as const },
      { occursOn: "2026-11-03", status: "missed" as const },
      { occursOn: "2026-11-04", status: "pending" as const },
    ];
    expect(calculateStreak(occs3, today)).toEqual({ currentStreak: 0, longestStreak: 1 });

    // Scenario 4: Excused day does NOT break streak
    const occs4 = [
      { occursOn: "2026-11-01", status: "done" as const },
      { occursOn: "2026-11-02", status: "excused" as const },
      { occursOn: "2026-11-03", status: "done" as const },
      { occursOn: "2026-11-04", status: "done" as const },
    ];
    expect(calculateStreak(occs4, today)).toEqual({ currentStreak: 4, longestStreak: 4 });

    // Scenario 5: Skipped day (on leave) does NOT break streak
    const occs5 = [
      { occursOn: "2026-11-01", status: "done" as const },
      { occursOn: "2026-11-02", status: "skipped" as const },
      { occursOn: "2026-11-03", status: "done" as const },
      { occursOn: "2026-11-04", status: "done" as const },
    ];
    expect(calculateStreak(occs5, today)).toEqual({ currentStreak: 3, longestStreak: 3 });
  });
});
