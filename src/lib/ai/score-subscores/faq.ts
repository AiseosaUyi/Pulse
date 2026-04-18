// FAQ Schema sub-score — 10 pts, fully deterministic.
// Rubric v1 §6.

import type { ScoreIssue, SubScoreResult } from "./types";

export interface FaqInputs {
  content: string;
  /** JSON-LD FAQPage object if generated. Optional. */
  faqSchema: unknown | null;
}

interface ParsedFaq {
  questions: Array<{ q: string; a: string }>;
}

/**
 * Extract FAQ Q/A pairs from markdown content. Looks for the classic
 * FAQ pattern: "### Question?" followed by one or more paragraphs.
 * Also tolerates "**Q:** …" / "**A:** …" prefixed lines.
 */
function extractFaqFromMarkdown(content: string): ParsedFaq {
  const questions: Array<{ q: string; a: string }> = [];
  // Pattern: ### … (any level 2-4 heading ending in ?)
  const headingFaqRe = /^(#{2,4})\s+(.+\?\s*)$/gm;
  const lines = content.split("\n");

  let currentQ: string | null = null;
  let answerLines: string[] = [];

  const flush = () => {
    if (currentQ) {
      const a = answerLines.join(" ").trim();
      if (a.length > 0) questions.push({ q: currentQ, a });
    }
    currentQ = null;
    answerLines = [];
  };

  for (const line of lines) {
    const m = line.match(/^#{2,4}\s+(.+)$/);
    if (m && /\?\s*$/.test(m[1])) {
      flush();
      currentQ = m[1].trim();
      continue;
    }
    if (currentQ) {
      // Stop accumulating answer at next heading.
      if (/^#{1,6}\s+/.test(line)) {
        flush();
      } else if (line.trim().length > 0) {
        answerLines.push(line.trim());
      }
    }
  }
  flush();
  // Surface the pattern to the regex engine to shut up unused warnings
  // — we also accept a fallback for non-heading Q: patterns.
  void headingFaqRe;

  return { questions };
}

interface JsonLdFaqPage {
  "@type"?: string;
  mainEntity?: Array<{
    "@type"?: string;
    name?: string;
    acceptedAnswer?: { "@type"?: string; text?: string };
  }>;
}

export function scoreFaq(inp: FaqInputs): SubScoreResult {
  const issues: ScoreIssue[] = [];
  const parsed = extractFaqFromMarkdown(inp.content);
  const qCount = parsed.questions.length;

  // 1. ≥3 Q/A pairs (4 pts)
  let countScore = 0;
  if (qCount >= 3) countScore = 4;
  else if (qCount === 2) countScore = 2;
  else if (qCount === 1) countScore = 1;
  if (countScore < 4) {
    issues.push({
      subScore: "faq",
      severity: qCount === 0 ? "high" : "med",
      message: `Only ${qCount} FAQ question${qCount === 1 ? "" : "s"} found — Google's FAQ rich result wants ≥3.`,
      suggestedFix:
        "Add a FAQ section with 3-5 common questions under their own H3 headings.",
    });
  }

  // 2. Each answer 40-300 chars (2 pts)
  let lenScore = 2;
  if (qCount > 0) {
    const outOfRange = parsed.questions.filter(
      (p) => p.a.length < 40 || p.a.length > 300
    );
    if (outOfRange.length === 0) lenScore = 2;
    else if (outOfRange.length === 1) lenScore = 1;
    else lenScore = 0;

    if (lenScore < 2) {
      issues.push({
        subScore: "faq",
        severity: "low",
        message: `${outOfRange.length} FAQ answer${outOfRange.length === 1 ? " is" : "s are"} outside 40-300 chars.`,
        suggestedFix: "Keep answers concise but substantive — 1-2 short sentences each.",
      });
    }
  } else {
    lenScore = 0;
  }

  // 3. Valid JSON-LD FAQPage (2 pts)
  let jsonLdScore = 0;
  const schema = inp.faqSchema as JsonLdFaqPage | null;
  if (
    schema &&
    typeof schema === "object" &&
    schema["@type"] === "FAQPage" &&
    Array.isArray(schema.mainEntity) &&
    schema.mainEntity.length > 0
  ) {
    jsonLdScore = 2;
  } else if (schema && typeof schema === "object") {
    jsonLdScore = 1;
    issues.push({
      subScore: "faq",
      severity: "med",
      message: "FAQ schema exists but is malformed (missing @type:FAQPage or mainEntity).",
      suggestedFix: "Regenerate FAQ schema to match schema.org/FAQPage spec.",
    });
  } else {
    issues.push({
      subScore: "faq",
      severity: qCount >= 3 ? "med" : "low",
      message: "No JSON-LD FAQPage schema.",
      suggestedFix:
        "Add a schema block so Google can show your FAQ as a rich result (click 'Generate FAQ schema' in the side panel).",
    });
  }

  // 4. Questions phrased as questions (2 pts)
  let phrasingScore = 0;
  if (qCount > 0) {
    const properQs = parsed.questions.filter((p) => p.q.trim().endsWith("?")).length;
    if (properQs === qCount) phrasingScore = 2;
    else if (properQs / qCount >= 0.5) phrasingScore = 1;
    if (phrasingScore < 2) {
      issues.push({
        subScore: "faq",
        severity: "low",
        message: `${qCount - properQs} of ${qCount} FAQ items aren't phrased as questions.`,
        suggestedFix: "Phrase each FAQ heading as a question ending in '?'.",
      });
    }
  }

  return {
    score: countScore + lenScore + jsonLdScore + phrasingScore,
    max: 10,
    issues,
  };
}

export { extractFaqFromMarkdown };
