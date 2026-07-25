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
// text on the FAQ heading itself ("## FAQ About X"), and a raw
// <script type="application/ld+json"> FAQPage block occasionally leaked
// straight into the body (stripped outright — any Q/A it carries is almost
// always duplicated as visible headings right after it).

const JSON_LD_SCRIPT_RE =
  /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>\n?/gi;

const FAQ_HEADING_RE =
  /^(?:#{2,4}\s+(?:Frequently Asked Questions|FAQs?)\b.*|\*\*\s*(?:Frequently Asked Questions|FAQs?)\b.*?\*\*)\s*$/im;

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
  const content = noJsonLd.replace(/\n{3,}/g, "\n\n");
  const jsonLdStripped = noJsonLd !== rawContent;

  const headingMatch = FAQ_HEADING_RE.exec(content);
  if (!headingMatch) {
    return {
      cleanedContent: content.trim() + "\n",
      extractedFaq: [],
      stripped: jsonLdStripped,
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

  return { cleanedContent, extractedFaq, stripped: true };
}
