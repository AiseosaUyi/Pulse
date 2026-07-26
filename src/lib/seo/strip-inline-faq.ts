// Defensive FAQ extraction/stripping. The SEO blog generator is instructed
// (generate-seo-blog.ts) to keep FAQ content out of body_markdown entirely —
// it belongs only in the structured `faq` field, which becomes
// blog_posts.faq_items → Contentful's `faqItems` field → the live site's
// existing FAQPage JSON-LD renderer (app/blogs/[slug]/page.tsx on the Gruve
// frontend). This is a safety net for when a model still writes an inline
// "Frequently Asked Questions" block anyway (or for cleaning up posts
// generated before this instruction existed): it pulls any such block out of
// the body and returns the Q/A pairs to merge into faq_items instead.
//
// Tolerates real headings ("### Question?"), the bold-pseudo-heading style
// ("**Question?**") the model sometimes uses instead of H2/H3, qualifier
// text on the FAQ heading itself ("## FAQ About X"), a raw
// <script type="application/ld+json"> FAQPage block occasionally leaked
// straight into the body, and — seen live on a real generated post — a
// ```json fenced code block containing a raw [{question, answer}, ...]
// array under a "**FAQ**" heading (a different generator than the one this
// module was originally written for, with no dedicated faq[] output field
// at all, so the model had nowhere else to put it).

const JSON_LD_SCRIPT_RE =
  /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>\n?/gi;

// Only matches a fenced block whose content parses as JSON — a legitimate
// ```json code example in an unrelated post won't parse as the FAQ shape
// below and is left untouched.
const JSON_FENCE_RE = /```(?:json)?[ \t]*\n(\[[\s\S]*?\])[ \t]*\n```\n?/gi;

const FAQ_HEADING_RE =
  /^(?:#{2,4}\s+(?:Frequently Asked Questions|FAQs?)\b.*|\*\*\s*(?:Frequently Asked Questions|FAQs?)\b.*?\*\*)\s*$/im;

interface RawFaqLikeEntry {
  question?: unknown;
  answer?: unknown;
}

/** Parses a fenced block's contents; returns entries only if it's genuinely
 *  an array of {question, answer} string pairs — anything else (a real code
 *  sample, an unrelated JSON array) is left alone. */
function parseJsonFaqArray(text: string): ExtractedFaqEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const entries: ExtractedFaqEntry[] = [];
  for (const item of parsed) {
    const q = (item as RawFaqLikeEntry)?.question;
    const a = (item as RawFaqLikeEntry)?.answer;
    if (typeof q === "string" && q.trim() && typeof a === "string" && a.trim()) {
      entries.push({ question: q.trim(), answer: a.trim() });
    }
  }
  return entries.length > 0 ? entries : null;
}

/** Strips any ```json fenced FAQ array from the content, extracting its
 *  entries. Leaves a heading directly above an emptied fence in place —
 *  extractAndStripFaqSection's existing heading pass cleans that up, since
 *  it already handles a heading with nothing but whitespace under it. */
function stripJsonFaqFences(content: string): {
  content: string;
  extracted: ExtractedFaqEntry[];
  stripped: boolean;
} {
  const extracted: ExtractedFaqEntry[] = [];
  const cleaned = content.replace(JSON_FENCE_RE, (match, arrayText: string) => {
    const parsed = parseJsonFaqArray(arrayText);
    if (!parsed) return match;
    extracted.push(...parsed);
    return "";
  });
  return { content: cleaned, extracted, stripped: extracted.length > 0 };
}

export interface ExtractedFaqEntry {
  question: string;
  answer: string;
}

export interface ExtractAndStripFaqResult {
  cleanedContent: string;
  extractedFaq: ExtractedFaqEntry[];
  /** True if content was modified (FAQ section and/or a leaked JSON-LD block removed). */
  stripped: boolean;
}

/** A markdown/bold line that is itself a question (the FAQ pattern). */
function questionFromLine(line: string): string | null {
  let m = /^#{2,4}\s+(.+?)\s*$/.exec(line);
  if (m && /\?\s*$/.test(m[1])) return m[1].trim();
  m = /^\*\*\s*(.+?)\s*\*\*\s*$/.exec(line);
  if (m && /\?\s*$/.test(m[1])) return m[1].trim();
  return null;
}

/**
 * A heading or whole-line-bold that is NOT a question — this ends the FAQ
 * zone (e.g. "## Conclusion", or a closing CTA written in the same
 * whole-line-bold style the questions used).
 */
function isSectionBoundary(line: string): boolean {
  if (questionFromLine(line)) return false;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\*\*\s*.+\*\*\s*$/.test(line)) return true;
  return false;
}

export function extractAndStripFaqSection(
  rawContent: string
): ExtractAndStripFaqResult {
  const noJsonLd = rawContent.replace(JSON_LD_SCRIPT_RE, "");
  const jsonLdStripped = noJsonLd !== rawContent;

  const fenceResult = stripJsonFaqFences(noJsonLd);
  const content = fenceResult.content.replace(/\n{3,}/g, "\n\n");

  const headingMatch = FAQ_HEADING_RE.exec(content);
  if (!headingMatch) {
    return {
      cleanedContent: content.trim() + "\n",
      extractedFaq: fenceResult.extracted,
      stripped: jsonLdStripped || fenceResult.stripped,
    };
  }

  const headingStart = headingMatch.index;
  const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
  const lines = afterHeading.split("\n");

  const extractedFaq: ExtractedFaqEntry[] = [];
  const trailingLines: string[] = [];
  let mode: "faq" | "after" = "faq";
  let currentQ: string | null = null;
  let currentA: string[] = [];

  const flush = () => {
    if (currentQ) {
      const answer = currentA.join(" ").replace(/\*\*/g, "").trim();
      if (answer) extractedFaq.push({ question: currentQ, answer });
    }
    currentQ = null;
    currentA = [];
  };

  for (const line of lines) {
    if (mode === "after") {
      trailingLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "---") continue; // separator between Q/A blocks — ignore
    const q = questionFromLine(trimmed);
    if (q) {
      flush();
      currentQ = q;
      continue;
    }
    if (isSectionBoundary(trimmed)) {
      flush();
      mode = "after";
      trailingLines.push(line);
      continue;
    }
    if (currentQ) {
      if (trimmed) currentA.push(trimmed);
    } else if (trimmed) {
      // Stray text between the FAQ heading and the first question — rare,
      // but preserve rather than silently drop.
      trailingLines.push(line);
    }
  }
  flush();

  const before = content
    .slice(0, headingStart)
    .replace(/\n[ \t]*---[ \t]*\n?\s*$/, "")
    .trimEnd();
  const trailing = trailingLines.join("\n").trim();
  const cleanedContent =
    (trailing ? `${before}\n\n${trailing}` : before)
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n";

  return {
    cleanedContent,
    // Fence-derived entries first — they're the more structured/reliable
    // source when both are somehow present.
    extractedFaq: [...fenceResult.extracted, ...extractedFaq],
    stripped: true,
  };
}
