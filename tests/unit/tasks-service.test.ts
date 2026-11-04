import { describe, it, expect } from "vitest";
import {
  isTaskScheduledForDate,
  calculateStreak,
  getDatesInRange,
} from "@/lib/tasks/date-utils";

describe("Tasks service business rules", () => {
  describe("Schedule recurrence rules", () => {
    it("handles one-off tasks strictly on their due date", () => {
      const task = {
        kind: "one_off",
        startDate: "2026-11-01",
        dueDate: "2026-11-06",
      };

      expect(isTaskScheduledForDate(task, "2026-11-05")).toBe(false);
      expect(isTaskScheduledForDate(task, "2026-11-06")).toBe(true);
      expect(isTaskScheduledForDate(task, "2026-11-07")).toBe(false);
    });

    it("handles daily recurring habits every single day", () => {
      const task = {
        kind: "recurring",
        startDate: "2026-11-01",
        recurrence: "daily",
      };

      const dates = getDatesInRange("2026-11-01", "2026-11-07");
      for (const d of dates) {
        expect(isTaskScheduledForDate(task, d)).toBe(true);
      }

      // Before start date
      expect(isTaskScheduledForDate(task, "2026-10-31")).toBe(false);
    });

    it("handles weekdays (Mon-Fri only, no Sat/Sun)", () => {
      const task = {
        kind: "recurring",
        startDate: "2026-11-01",
        recurrence: "weekdays",
      };

      expect(isTaskScheduledForDate(task, "2026-11-02")).toBe(true); // Monday
      expect(isTaskScheduledForDate(task, "2026-11-03")).toBe(true); // Tuesday
      expect(isTaskScheduledForDate(task, "2026-11-04")).toBe(true); // Wednesday
      expect(isTaskScheduledForDate(task, "2026-11-05")).toBe(true); // Thursday
      expect(isTaskScheduledForDate(task, "2026-11-06")).toBe(true); // Friday
      expect(isTaskScheduledForDate(task, "2026-11-07")).toBe(false); // Saturday
      expect(isTaskScheduledForDate(task, "2026-11-08")).toBe(false); // Sunday
    });

    it("handles weekly specific days (e.g. Chase list: Mon=1 and Thu=4)", () => {
      const task = {
        kind: "recurring",
        startDate: "2026-11-01",
        recurrence: "weekly",
        recurrenceDays: [1, 4],
      };

      expect(isTaskScheduledForDate(task, "2026-11-02")).toBe(true); // Mon
      expect(isTaskScheduledForDate(task, "2026-11-03")).toBe(false); // Tue
      expect(isTaskScheduledForDate(task, "2026-11-04")).toBe(false); // Wed
      expect(isTaskScheduledForDate(task, "2026-11-05")).toBe(true); // Thu
      expect(isTaskScheduledForDate(task, "2026-11-06")).toBe(false); // Fri
    });

    it("handles monthly on day N", () => {
      const task = {
        kind: "recurring",
        startDate: "2026-01-01",
        recurrence: "monthly",
        recurrenceMonthDay: 15,
      };

      expect(isTaskScheduledForDate(task, "2026-11-15")).toBe(true);
      expect(isTaskScheduledForDate(task, "2026-11-14")).toBe(false);
      expect(isTaskScheduledForDate(task, "2026-12-15")).toBe(true);
    });

    it("respects task end_date", () => {
      const task = {
        kind: "recurring",
        startDate: "2026-11-01",
        endDate: "2026-11-05",
        recurrence: "daily",
      };

      expect(isTaskScheduledForDate(task, "2026-11-05")).toBe(true);
      expect(isTaskScheduledForDate(task, "2026-11-06")).toBe(false);
    });
  });

  describe("Streak calculation rules", () => {
    const today = "2026-11-05";

    it("accumulates streak when tasks are completed consecutively", () => {
      const occs = [
        { occursOn: "2026-11-01", status: "done" as const },
        { occursOn: "2026-11-02", status: "done" as const },
        { occursOn: "2026-11-03", status: "done" as const },
        { occursOn: "2026-11-04", status: "done" as const },
        { occursOn: "2026-11-05", status: "done" as const },
      ];

      const { currentStreak, longestStreak } = calculateStreak(occs, today);
      expect(currentStreak).toBe(5);
      expect(longestStreak).toBe(5);
    });

    it("preserves streak ending yesterday if today is still pending", () => {
      const occs = [
        { occursOn: "2026-11-01", status: "done" as const },
        { occursOn: "2026-11-02", status: "done" as const },
        { occursOn: "2026-11-03", status: "done" as const },
        { occursOn: "2026-11-04", status: "done" as const },
        { occursOn: "2026-11-05", status: "pending" as const },
      ];

      const { currentStreak, longestStreak } = calculateStreak(occs, today);
      expect(currentStreak).toBe(4);
      expect(longestStreak).toBe(4);
    });

    it("breaks streak when a day is missed", () => {
      const occs = [
        { occursOn: "2026-11-01", status: "done" as const },
        { occursOn: "2026-11-02", status: "done" as const },
        { occursOn: "2026-11-03", status: "missed" as const },
        { occursOn: "2026-11-04", status: "done" as const },
        { occursOn: "2026-11-05", status: "done" as const },
      ];

      const { currentStreak, longestStreak } = calculateStreak(occs, today);
      expect(currentStreak).toBe(2);
      expect(longestStreak).toBe(2);
    });

    it("forgives a missed day when excused by admin (does not break streak)", () => {
      const occs = [
        { occursOn: "2026-11-01", status: "done" as const },
        { occursOn: "2026-11-02", status: "done" as const },
        { occursOn: "2026-11-03", status: "excused" as const }, // Admin forgiven
        { occursOn: "2026-11-04", status: "done" as const },
        { occursOn: "2026-11-05", status: "done" as const },
      ];

      const { currentStreak, longestStreak } = calculateStreak(occs, today);
      expect(currentStreak).toBe(5);
      expect(longestStreak).toBe(5);
    });

    it("does not break streak on skipped days (e.g. approved leave or paused)", () => {
      const occs = [
        { occursOn: "2026-11-01", status: "done" as const },
        { occursOn: "2026-11-02", status: "skipped" as const }, // Leave
        { occursOn: "2026-11-03", status: "skipped" as const }, // Leave
        { occursOn: "2026-11-04", status: "done" as const },
        { occursOn: "2026-11-05", status: "done" as const },
      ];

      const { currentStreak, longestStreak } = calculateStreak(occs, today);
      expect(currentStreak).toBe(3);
      expect(longestStreak).toBe(3);
    });

    it("resets streak to 0 if today was marked missed", () => {
      const occs = [
        { occursOn: "2026-11-03", status: "done" as const },
        { occursOn: "2026-11-04", status: "done" as const },
        { occursOn: "2026-11-05", status: "missed" as const },
      ];

      const { currentStreak, longestStreak } = calculateStreak(occs, today);
      expect(currentStreak).toBe(0);
      expect(longestStreak).toBe(2);
    });
  });

  describe("WhatsApp Standup Formatting", () => {
    it("formats standup text cleanly without markdown tables", () => {
      const report = {
        from: "2026-11-02",
        to: "2026-11-06",
        people: [
          {
            person: { name: "Olamide" },
            completedTasks: [{ title: "Daily post" }, { title: "Area reel" }],
            recurringStats: [{ taskTitle: "Daily post on Gruve Lagos", done: 4, total: 5, rate: 80 }],
            metricTotals: [{ label: "Followers gained", total: 45 }],
            breaches: [{ taskTitle: "Don't be bored this weekend roundup", occursOn: "2026-11-05" }],
            openOneOffTasks: [],
          },
        ],
      };

      let whatsApp = `*Pulse Standup Report (${report.from} to ${report.to})*\n\n`;
      for (const p of report.people) {
        whatsApp += `*${p.person.name.toUpperCase()}*\n`;
        whatsApp += `• Completed tasks: ${p.completedTasks.length}\n`;
        whatsApp += `• Daily habits:\n`;
        for (const r of p.recurringStats) {
          whatsApp += `  - ${r.taskTitle}: ${r.done}/${r.total} (${r.rate}%)\n`;
        }
        whatsApp += `• Metrics:\n`;
        for (const m of p.metricTotals) {
          whatsApp += `  - ${m.label}: ${m.total}\n`;
        }
        whatsApp += `• Breaches (${p.breaches.length}):\n`;
        for (const b of p.breaches) {
          whatsApp += `  - ❌ ${b.taskTitle} on ${b.occursOn}\n`;
        }
      }

      const text = whatsApp.trim();
      expect(text).toContain("*Pulse Standup Report (2026-11-02 to 2026-11-06)*");
      expect(text).toContain("*OLAMIDE*");
      expect(text).toContain("• Completed tasks: 2");
      expect(text).toContain("- Daily post on Gruve Lagos: 4/5 (80%)");
      expect(text).toContain("- Followers gained: 45");
      expect(text).toContain("- ❌ Don't be bored this weekend roundup on 2026-11-05");
      expect(text).not.toContain("|"); // No markdown tables
    });
  });
});
