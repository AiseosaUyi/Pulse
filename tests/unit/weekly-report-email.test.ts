import { describe, it, expect } from "vitest";
import { weeklyDigestHtml } from "@/lib/email/weekly-digest-email";

const base = { tenantName: "Acme", weekOf: "2026-11-21", wins: [], drags: [], nextWeekFocus: [], aiCostUsd: 0 };

describe("weekly report email", () => {
  it("uses the strategic brief when there is no narrative, and lists actions with a tasks link", () => {
    const html = weeklyDigestHtml({
      ...base,
      narrative: null,
      strategicBrief: "We added 45 leads.",
      actions: [
        { priority: 2, action: "Second", rationale: "why 2" },
        { priority: 1, action: "First <b>", rationale: "why 1" },
      ],
      reportUrl: "https://app/weekly-report",
    });
    expect(html).toContain("We added 45 leads.");
    expect(html).toContain("First &lt;b&gt;");
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
    expect(html).toContain("Turn these into tasks");
    expect(html).toContain("https://app/weekly-report");
  });

  it("no actions: no actions block", () => {
    const html = weeklyDigestHtml({ ...base, narrative: "Quiet week." });
    expect(html).toContain("Quiet week.");
    expect(html).not.toContain("Recommended actions");
  });
});
