import { describe, it, expect } from "vitest";
import { truncateSafe } from "@/lib/utils";

// Regression test for a real production crash: the Signals page's "X
// signals" tab threw `URIError: URI malformed` and hard-crashed to the
// error boundary the moment a real X post's tweetText was sliced at a
// fixed character count that landed inside an emoji's UTF-16 surrogate
// pair, then passed to encodeURIComponent(). Confirmed via `/investigate`
// by reproducing the exact URIError with a real emoji-containing string.
describe("truncateSafe", () => {
  it("returns the string unchanged when under the limit", () => {
    expect(truncateSafe("hello", 10)).toBe("hello");
  });

  it("truncates plain ASCII at the exact boundary", () => {
    expect(truncateSafe("hello world", 5)).toBe("hello");
  });

  it("never produces a string that crashes encodeURIComponent, even when the cut lands mid-surrogate-pair", () => {
    // 😀 is U+1F600, a 2-code-unit (surrogate pair) character in JS strings.
    const text = "Great news today 😀 more content after the emoji";
    const idx = text.indexOf("😀");
    // Slicing at idx+1 would land exactly between the emoji's high and low
    // surrogate — the literal bug: `text.slice(0, idx + 1)` crashes
    // encodeURIComponent with "URI malformed" (reproduced directly below
    // without the fix, to prove this test would have failed pre-fix).
    expect(() => encodeURIComponent(text.slice(0, idx + 1))).toThrow(URIError);

    // With the fix: no throw, for every cut point near the emoji.
    for (let n = idx - 1; n <= idx + 2; n++) {
      const truncated = truncateSafe(text, n);
      expect(() => encodeURIComponent(truncated)).not.toThrow();
      expect(truncated.length).toBeLessThanOrEqual(n);
    }
  });

  it("truncates a long string with no special characters normally", () => {
    const text = "a".repeat(500);
    expect(truncateSafe(text, 200)).toHaveLength(200);
  });
});
