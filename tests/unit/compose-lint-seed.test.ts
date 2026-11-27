import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads the lint regexes exactly as migration 115 seeds them, decoded the way
 * Postgres does with standard_conforming_strings=on (backslashes literal,
 * '' is one quote). Guards against the double-escape bug where '\\b' was
 * stored as two backslashes and the rules silently never matched.
 */
function seededRegexes(): string[] {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/115_lead_research_and_outreach_memory.sql"),
    "utf8"
  );
  const literals = [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  return literals.filter((l) => l.startsWith("\\b("));
}

describe("migration 115 seeded lint regexes", () => {
  const all = seededRegexes();
  // 2 column defaults + 4 per tenant for gruve and sippy
  it("finds every seeded regex", () => {
    expect(all.length).toBe(10);
  });

  it("stores single backslashes", () => {
    for (const r of all) expect(r).not.toContain("\\\\");
  });

  const [, , gruveBanned, gruvePromise, gruveSubject, gruveVerdict, sippyBanned, sippyPromise] = all;
  const re = (s: string) => new RegExp(s, "i");

  it("banned words fire", () => {
    expect(re(gruveBanned).test("a partnership with you")).toBe(true);
    expect(re(gruveBanned).test("this is amazing")).toBe(true);
    expect(re(sippyBanned).test("our price list")).toBe(true);
    expect(re(gruveBanned).test("we run ticketing for venues")).toBe(false);
  });

  it("promises fire, including I'll", () => {
    expect(re(gruvePromise).test("I will build a free demo")).toBe(true);
    expect(re(gruvePromise).test("I'll send a mockup")).toBe(true);
    expect(re(sippyPromise).test("I'll make you a sample")).toBe(true);
  });

  it("bad subjects and verdicts fire", () => {
    expect(re(gruveSubject).test("Quick question about tickets")).toBe(true);
    expect(re(gruveVerdict).test("love your events")).toBe(true);
    expect(re(gruveVerdict).test("lovely")).toBe(false);
  });
});
