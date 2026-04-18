import { describe, it, expect } from "vitest";
import {
  countWords,
  withinTolerance,
  deviation,
  bandFromWordCount,
  LENGTH_BANDS,
} from "@/lib/blog/word-count";

describe("countWords", () => {
  it("returns 0 for empty or null-ish input", () => {
    expect(countWords("")).toBe(0);
  });

  it("counts plain prose", () => {
    expect(countWords("Hello world, this is a test.")).toBe(6);
  });

  it("ignores heading hash markers", () => {
    expect(countWords("# Hello world")).toBe(2);
    expect(countWords("### Hello world")).toBe(2);
  });

  it("drops fenced code blocks entirely", () => {
    const md = "Before block.\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\nAfter block.";
    expect(countWords(md)).toBe(4); // Before block. After block.
  });

  it("keeps inline code content (strips backticks)", () => {
    expect(countWords("Use the `fetchBytes` helper function")).toBe(5);
  });

  it("uses link text only, drops URLs", () => {
    expect(countWords("Check [our docs](https://example.com/deep/path) today")).toBe(4);
  });

  it("uses image alt text, drops URLs", () => {
    expect(countWords("![cover frame](https://cdn/foo.jpg) Here is the image")).toBe(6);
  });

  it("counts list items", () => {
    expect(countWords("- First item\n- Second item\n- Third")).toBe(5);
    expect(countWords("1. First\n2. Second\n3. Third")).toBe(3);
  });

  it("strips emphasis markers but keeps content", () => {
    expect(countWords("This is **very important** text")).toBe(5);
    expect(countWords("This is *italicized* text")).toBe(4);
  });

  it("ignores blockquote markers", () => {
    expect(countWords("> A quoted line\n> Another quoted line")).toBe(6);
  });

  it("ignores pure-punctuation tokens", () => {
    expect(countWords("Hello --- world .")).toBe(2);
  });

  it("handles a realistic article with sections, lists, headings", () => {
    // "Event ticketing in Nigeria has grown rapidly in 2026." = 9 words
    const para = "Event ticketing in Nigeria has grown rapidly in 2026. ".repeat(30);
    const md = `# Title\n\n## Intro\n\n${para}\n\n## Body\n\n${para}\n\n- point one\n- point two\n\n## Conclusion\n\n${para}`;
    const n = countWords(md);
    // 3 paras × 30 reps × 9 words = 810, plus "Title", "Intro", "Body",
    // "Conclusion", and 4 bullet-point words = ~818. Allow a small band.
    expect(n).toBeGreaterThanOrEqual(810);
    expect(n).toBeLessThanOrEqual(825);
  });
});

describe("withinTolerance", () => {
  it("treats actual within 10% as ok by default", () => {
    expect(withinTolerance(1080, 1200)).toBe(true); // -10%
    expect(withinTolerance(1320, 1200)).toBe(true); // +10%
  });

  it("rejects actual outside 10%", () => {
    expect(withinTolerance(1079, 1200)).toBe(false);
    expect(withinTolerance(1321, 1200)).toBe(false);
  });

  it("custom tolerance", () => {
    expect(withinTolerance(1100, 1200, 0.05)).toBe(false);
    expect(withinTolerance(1100, 1200, 0.1)).toBe(true);
  });

  it("target=0 is trivially within tolerance", () => {
    expect(withinTolerance(0, 0)).toBe(true);
    expect(withinTolerance(500, 0)).toBe(true);
  });
});

describe("deviation", () => {
  it("signed fraction — positive when over, negative when under", () => {
    expect(deviation(1320, 1200)).toBeCloseTo(0.1);
    expect(deviation(1080, 1200)).toBeCloseTo(-0.1);
    expect(deviation(1200, 1200)).toBe(0);
  });
});

describe("bandFromWordCount", () => {
  it("maps common targets to the right band midpoint", () => {
    expect(bandFromWordCount(750)).toBe("short");
    expect(bandFromWordCount(1200)).toBe("medium");
    expect(bandFromWordCount(2100)).toBe("long");
    expect(bandFromWordCount(3150)).toBe("comprehensive");
  });

  it("picks the closest band for odd values", () => {
    expect(bandFromWordCount(1500)).toBe("medium"); // 1500 is closer to medium 1200 than long 2100
    expect(bandFromWordCount(1800)).toBe("long"); // tie/close to long
  });

  it("LENGTH_BANDS shape is stable", () => {
    expect(LENGTH_BANDS.medium.target).toBe(1200);
    expect(LENGTH_BANDS.comprehensive.max).toBe(3500);
  });
});
