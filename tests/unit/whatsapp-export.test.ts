import { describe, it, expect } from "vitest";
import {
  guessLeadSender,
  parseWhatsAppExport,
  phoneFromSender,
  toImportMessages,
} from "@/lib/outreach-autopilot/whatsapp-export";

describe("parseWhatsAppExport", () => {
  it("reads Android 24h lines (Lagos time to UTC)", () => {
    const c = parseWhatsAppExport("27/11/2026, 10:15 - Ada Obi: Hello there");
    expect(c.lines).toEqual([{ sender: "Ada Obi", text: "Hello there", at: "2026-11-27T09:15:00.000Z" }]);
  });

  it("reads Android 12h with single-digit day, month and hour and a 2-digit year", () => {
    const c = parseWhatsAppExport("1/2/26, 9:05 pm - Ada: hi");
    expect(c.lines[0]).toEqual({ sender: "Ada", text: "hi", at: "2026-02-01T20:05:00.000Z" });
  });

  it("reads iPhone lines with seconds, AM/PM and the invisible marks", () => {
    const raw = "‎[3/11/26, 12:04:09 AM] Ada: late night\n[27/11/2026, 10:15:32] Sippy Sales: morning";
    const c = parseWhatsAppExport(raw);
    expect(c.lines.map((l) => l.at)).toEqual(["2026-11-02T23:04:09.000Z", "2026-11-27T09:15:32.000Z"]);
    expect(c.senders).toEqual(["Ada", "Sippy Sales"]);
  });

  it("keeps the digits 2 and 0 and the letters U and F (old bug)", () => {
    const c = parseWhatsAppExport("20/10/2026, 20:02 - FUFU Spot: 200 crates UF");
    expect(c.lines[0].sender).toBe("FUFU Spot");
    expect(c.lines[0].text).toBe("200 crates UF");
  });

  it("joins multi-line messages and skips system lines", () => {
    const raw = [
      "27/11/2026, 10:00 - Messages and calls are end-to-end encrypted.",
      "27/11/2026, 10:01 - Ada: first line",
      "second line",
      "27/11/2026, 10:02 - Ada changed the group name",
      "stray line after a system message",
      "27/11/2026, 10:03 - Bola: ok <This message was edited>",
    ].join("\n");
    const c = parseWhatsAppExport(raw);
    expect(c.lines.map((l) => l.text)).toEqual(["first line\nsecond line", "ok"]);
  });

  it("swaps day and month when the first number can't be a month, and honours month-first", () => {
    expect(parseWhatsAppExport("11/27/26, 10:00 - A: x").lines[0].at).toBe("2026-11-27T09:00:00.000Z");
    expect(parseWhatsAppExport("2/1/26, 10:00 - A: x", { dayFirst: false }).lines[0].at).toBe(
      "2026-02-01T09:00:00.000Z"
    );
  });

  it("uses the given offset and drops impossible dates", () => {
    expect(parseWhatsAppExport("27/11/2026, 10:00 - A: x", { utcOffset: "+00:00" }).lines[0].at).toBe(
      "2026-11-27T10:00:00.000Z"
    );
    expect(parseWhatsAppExport("31/02/2026, 10:00 - A: x").lines).toEqual([]);
  });

  it("handles 12am and 12pm", () => {
    const c = parseWhatsAppExport("1/1/26, 12:30 am - A: x\n1/1/26, 12:30 pm - A: y", { utcOffset: "+00:00" });
    expect(c.lines.map((l) => l.at)).toEqual(["2026-01-01T00:30:00.000Z", "2026-01-01T12:30:00.000Z"]);
  });
});

describe("toImportMessages", () => {
  it("marks the lead as them, drops media and deleted messages", () => {
    const c = parseWhatsAppExport(
      [
        "27/11/2026, 10:00 - Ada: <Media omitted>",
        "27/11/2026, 10:01 - Ada: how much for a crate?",
        "[27/11/2026, 10:02:00] Me: ‎image omitted",
        "27/11/2026, 10:03 - Me: This message was deleted",
        "27/11/2026, 10:04 - Me: 18k",
      ].join("\n")
    );
    expect(toImportMessages(c, "Ada")).toEqual([
      { from: "them", text: "how much for a crate?", at: "2026-11-27T09:01:00.000Z" },
      { from: "us", text: "18k", at: "2026-11-27T09:04:00.000Z" },
    ]);
  });
});

describe("helpers", () => {
  it("reads a phone from an unsaved contact's sender name", () => {
    expect(phoneFromSender("+234 802 282 1263")).toBe("+2348022821263");
    expect(phoneFromSender("Ada Obi")).toBeNull();
    expect(phoneFromSender("Ada 0802")).toBeNull();
  });

  it("guesses the lead as the only sender who isn't us", () => {
    expect(guessLeadSender(["Ada", "Tunde Sippy"], ["Tunde"])).toBe("Ada");
    expect(guessLeadSender(["Ada", "Bola"], [])).toBeNull();
  });
});
