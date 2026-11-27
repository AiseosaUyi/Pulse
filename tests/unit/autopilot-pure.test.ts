import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isDigestDue,
  isInSendWindow,
  localParts,
  perTickQuota,
  startOfLocalDay,
} from "@/lib/outreach-autopilot/schedule";
import {
  bannedWordsFromRegex,
  isOptOut,
  rebuildBannedRegex,
  renderFollowUp,
  replySubject,
  stripQuotedReply,
  textToHtml,
} from "@/lib/outreach-autopilot/templates";

const LAGOS = "Africa/Lagos"; // UTC+1, no DST
const W = { sendWindowStart: 9, sendWindowEnd: 17, sendWeekdays: [1, 2, 3, 4, 5] };

describe("schedule", () => {
  it("reads local hour and weekday in the tenant timezone", () => {
    // 2026-11-27 is a Friday. 08:30 UTC = 09:30 Lagos.
    expect(localParts(new Date("2026-11-27T08:30:00Z"), LAGOS)).toEqual({ hour: 9, isoWeekday: 5, dateKey: "2026-11-27" });
    // 23:30 UTC Friday = 00:30 Saturday in Lagos.
    expect(localParts(new Date("2026-11-27T23:30:00Z"), LAGOS)).toMatchObject({ hour: 0, isoWeekday: 6, dateKey: "2026-11-28" });
  });

  it("only sends inside the window on allowed days", () => {
    expect(isInSendWindow(new Date("2026-11-27T08:30:00Z"), LAGOS, W)).toBe(true); // Fri 09:30
    expect(isInSendWindow(new Date("2026-11-27T07:59:00Z"), LAGOS, W)).toBe(false); // Fri 08:59
    expect(isInSendWindow(new Date("2026-11-27T16:00:00Z"), LAGOS, W)).toBe(false); // Fri 17:00, end is exclusive
    expect(isInSendWindow(new Date("2026-11-28T10:00:00Z"), LAGOS, W)).toBe(false); // Saturday
  });

  it("finds local midnight as a UTC instant", () => {
    expect(startOfLocalDay(new Date("2026-11-27T12:00:00Z"), LAGOS).toISOString()).toBe("2026-11-26T23:00:00.000Z");
    expect(startOfLocalDay(new Date("2026-11-27T23:30:00Z"), LAGOS).toISOString()).toBe("2026-11-27T23:00:00.000Z");
    // A DST zone still lands on midnight.
    expect(startOfLocalDay(new Date("2026-07-01T12:00:00Z"), "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("paces the daily cap across the rest of the window", () => {
    expect(perTickQuota({ dailyCap: 30, sentToday: 0, localHour: 9, sendWindowEnd: 17, ticksPerHour: 2 })).toBe(2);
    expect(perTickQuota({ dailyCap: 30, sentToday: 28, localHour: 16, sendWindowEnd: 17, ticksPerHour: 2 })).toBe(1);
    expect(perTickQuota({ dailyCap: 30, sentToday: 30, localHour: 10, sendWindowEnd: 17, ticksPerHour: 2 })).toBe(0);
    expect(perTickQuota({ dailyCap: 10, sentToday: 0, localHour: 16, sendWindowEnd: 17, ticksPerHour: 2 })).toBe(5);
    // Never more than what's left.
    expect(perTickQuota({ dailyCap: 3, sentToday: 2, localHour: 16, sendWindowEnd: 17, ticksPerHour: 2 })).toBe(1);
  });

  it("sends the digest once per local day, at or after the hour", () => {
    const at = (iso: string) => new Date(iso);
    expect(isDigestDue(at("2026-11-27T06:00:00Z"), LAGOS, 8, null)).toBe(false); // 07:00 local
    expect(isDigestDue(at("2026-11-27T07:00:00Z"), LAGOS, 8, null)).toBe(true); // 08:00 local
    expect(isDigestDue(at("2026-11-27T10:00:00Z"), LAGOS, 8, "2026-11-27T07:05:00Z")).toBe(false);
    expect(isDigestDue(at("2026-11-28T07:30:00Z"), LAGOS, 8, "2026-11-27T07:05:00Z")).toBe(true);
  });
});

describe("templates", () => {
  it("fills follow-up tokens", () => {
    const out = renderFollowUp("{greeting}\n\nHow is {company} doing, {first_name}?\n\n\n\n{signature}", {
      greeting: "Hi Ada,",
      company: "Acme Events",
      signature: "Aise",
      firstName: "Ada",
    });
    expect(out).toBe("Hi Ada,\n\nHow is Acme Events doing, Ada?\n\nAise");
  });

  it("prefixes Re: once", () => {
    expect(replySubject("Tickets for Acme")).toBe("Re: Tickets for Acme");
    expect(replySubject("RE: Tickets")).toBe("RE: Tickets");
    expect(replySubject(null)).toBe("Re: following up");
  });

  it("keeps only the new text of a reply", () => {
    const reply = "Yes, let's talk Tuesday.\n\nOn Mon, 3 Nov 2026 at 10:00, Aise <a@gruve.events> wrote:\n> Hi Ada,\n> old text";
    expect(stripQuotedReply(reply)).toBe("Yes, let's talk Tuesday.");
  });

  it("spots opt-outs but not ordinary no's", () => {
    expect(isOptOut("Please remove me from your list")).toBe(true);
    expect(isOptOut("UNSUBSCRIBE")).toBe(true);
    expect(isOptOut("Not interested right now, thanks")).toBe(false);
  });

  it("escapes HTML in email bodies", () => {
    expect(textToHtml("a <b> & c\nd\n\ne")).toBe("<p>a &lt;b&gt; &amp; c<br>d</p>\n<p>e</p>");
  });
});

describe("banned words round-trip against the real seeded regex", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/115_lead_research_and_outreach_memory.sql"), "utf8");
  const literals = [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  const seeded = literals.find((l) => l.startsWith("\\b(amazing"))!;

  it("keeps existing patterns and the punctuation rule when saved unchanged", () => {
    const words = bannedWordsFromRegex(seeded);
    expect(words).toContain("game-?changer");
    expect(rebuildBannedRegex(words, seeded)).toBe(seeded);
  });

  it("escapes a new word and still flags punctuation", () => {
    const words = [...bannedWordsFromRegex(seeded), "c.e.o"];
    const re = new RegExp(rebuildBannedRegex(words, seeded), "i");
    expect(re.test("talk to the c.e.o")).toBe(true);
    expect(re.test("talk to the cxexo")).toBe(false); // dots are literal
    expect(re.test("a real gamechanger")).toBe(true); // old pattern kept
    expect(re.test("great news!")).toBe(true); // punctuation tail kept
  });

  it("removing every word still leaves a valid regex", () => {
    const re = new RegExp(rebuildBannedRegex([], "\\b(a|b)\\b"), "i");
    expect(re.test("anything")).toBe(false);
  });
});
