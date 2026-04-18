// Word-count helpers used by the blog generator and the scoring engine.
//
// The generator counts words on the markdown body to decide whether to
// run an expansion pass. The scoring engine uses the same function so
// "target word count" and "scored word count" never disagree.

/**
 * Strip markdown formatting and return a plain-text word count.
 *
 * Applies conservative cleaning — fenced code blocks, inline code,
 * image/link syntax, and heading hashes are removed so we don't count
 * ``` or `##` as words. Tables, lists, and blockquotes keep their
 * content.
 */
export function countWords(markdown: string): number {
  if (!markdown) return 0;

  const cleaned = markdown
    // Fenced code blocks — drop entirely
    .replace(/```[\s\S]*?```/g, " ")
    // Inline code — keep the content but strip the backticks
    .replace(/`([^`]+)`/g, "$1")
    // Images — replace with alt text only: ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Links — replace with link text only: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Heading markers
    .replace(/^#{1,6}\s+/gm, "")
    // Blockquote markers
    .replace(/^>\s?/gm, "")
    // List markers
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Emphasis markers — keep the content
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");

  const words = cleaned
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w));

  return words.length;
}

/**
 * True when `actual` is within `tolerance` of `target`.
 * Defaults to 10% tolerance. Matches the Phase A rule: if the delivered
 * draft is off by more than 10% of the requested length, we run an
 * expansion pass.
 */
export function withinTolerance(
  actual: number,
  target: number,
  tolerance = 0.1
): boolean {
  if (target <= 0) return true;
  return Math.abs(actual - target) / target <= tolerance;
}

/** Signed deviation fraction. Positive = over target, negative = under. */
export function deviation(actual: number, target: number): number {
  if (target <= 0) return 0;
  return (actual - target) / target;
}

/** Word-count band the user picked in NewBlogPostModal, kept here so
 * the modal, generator, and score UI agree on the midpoints + labels. */
export const LENGTH_BANDS = {
  short: { label: "Short", min: 600, max: 900, target: 750 },
  medium: { label: "Medium", min: 1000, max: 1400, target: 1200 },
  long: { label: "Long", min: 1800, max: 2400, target: 2100 },
  comprehensive: { label: "Comprehensive", min: 2800, max: 3500, target: 3150 },
} as const;

export type LengthBand = keyof typeof LENGTH_BANDS;

export function bandFromWordCount(target: number): LengthBand {
  const entries = Object.entries(LENGTH_BANDS) as Array<
    [LengthBand, (typeof LENGTH_BANDS)[LengthBand]]
  >;
  let best: LengthBand = "medium";
  let bestDelta = Infinity;
  for (const [key, band] of entries) {
    const d = Math.abs(band.target - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = key;
    }
  }
  return best;
}
