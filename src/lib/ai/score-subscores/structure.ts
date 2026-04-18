// Structure sub-score — 10 pts, fully deterministic.
// Rubric v1 §5.

import { countWords } from "@/lib/blog/word-count";
import type { ScoreIssue, SubScoreResult } from "./types";

export interface StructureInputs {
  content: string;
}

function headingIndices(content: string): Array<{ level: number; index: number; text: string }> {
  const lines = content.split("\n");
  const out: Array<{ level: number; index: number; text: string }> = [];
  lines.forEach((line, idx) => {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) out.push({ level: m[1].length, index: idx, text: m[2].trim() });
  });

  // Heal markdown that uses `#` for every heading. TipTap's WYSIWYG
  // has H1 disabled (`levels: [2, 3, 4]`) and renders every `#` as an
  // H2, so what the user sees matches that intent. If we spot >3 H1s
  // and no H2s, treat the first H1 as the title and demote the rest
  // to H2 for scoring. Without this the structure rubric would punish
  // content that already looks fine to a reader.
  const h1Count = out.filter((h) => h.level === 1).length;
  const h2Count = out.filter((h) => h.level === 2).length;
  if (h1Count > 3 && h2Count === 0) {
    let seenFirst = false;
    return out.map((h) => {
      if (h.level !== 1) return h;
      if (!seenFirst) {
        seenFirst = true;
        return h;
      }
      return { ...h, level: 2 };
    });
  }
  return out;
}

export function scoreStructure(inp: StructureInputs): SubScoreResult {
  const issues: ScoreIssue[] = [];
  const headings = headingIndices(inp.content);
  const h1s = headings.filter((h) => h.level === 1);
  const h2s = headings.filter((h) => h.level === 2);
  const h3s = headings.filter((h) => h.level === 3);

  // 1. H1 unique
  let h1Score = 0;
  if (h1s.length === 1) h1Score = 2;
  if (h1Score < 2) {
    issues.push({
      subScore: "structure",
      severity: "high",
      message:
        h1s.length === 0
          ? "No H1 heading."
          : `Multiple H1 headings (${h1s.length}) — should be exactly one.`,
      suggestedFix: "Use exactly one H1 (the post title).",
    });
  }

  // 2. ≥3 H2s
  let h2Score = 0;
  if (h2s.length >= 3) h2Score = 2;
  else if (h2s.length === 2) h2Score = 1;
  if (h2Score < 2) {
    issues.push({
      subScore: "structure",
      severity: h2Score === 0 ? "high" : "med",
      message: `Only ${h2s.length} H2 sections — target 3+ for scanability.`,
      suggestedFix: "Break the article into ≥3 main sections with H2 headings.",
    });
  }

  // 3. No H3 before H2
  let hierarchyScore = 1;
  if (h3s.length > 0) {
    const firstH2 = h2s[0]?.index ?? Infinity;
    const orphanH3s = h3s.filter((h) => h.index < firstH2);
    if (orphanH3s.length > 0) {
      hierarchyScore = 0;
      issues.push({
        subScore: "structure",
        severity: "med",
        message: "H3 headings appear before the first H2.",
        suggestedFix:
          "Make sure every H3 sits under an H2 — the hierarchy helps both readers and search engines.",
      });
    }
  }

  // 4. At least one list or table
  let listScore = 0;
  const hasList = /^\s*([-*+]|\d+\.)\s+/m.test(inp.content);
  const hasTable = /^\s*\|.*\|\s*$/m.test(inp.content);
  if (hasList || hasTable) listScore = 2;
  if (listScore < 2) {
    issues.push({
      subScore: "structure",
      severity: "med",
      message: "No lists or tables — reads like a wall of prose.",
      suggestedFix: "Add at least one bulleted list or comparison table.",
    });
  }

  // 5. Intro ≤150 words — take text from H1 (or start) to first H2.
  let introScore = 0;
  const firstH2 = h2s[0];
  const introEnd = firstH2 ? firstH2.index : inp.content.split("\n").length;
  const h1Idx = h1s[0]?.index ?? -1;
  const introText = inp.content
    .split("\n")
    .slice(h1Idx + 1, introEnd)
    .join("\n");
  const introWords = countWords(introText);
  if (introWords > 0 && introWords <= 150) introScore = 1;
  if (introScore < 1) {
    issues.push({
      subScore: "structure",
      severity: "low",
      message:
        introWords === 0
          ? "No intro paragraph before the first H2."
          : `Intro is ${introWords} words — trim to ≤150 for faster hook.`,
      suggestedFix: "Tighten the intro to the key promise in one short paragraph.",
    });
  }

  // 6. Conclusion section
  let conclusionScore = 0;
  const conclusionRe = /conclusion|wrap.?up|final|summary|takeaways/i;
  if (h2s.length > 0 && conclusionRe.test(h2s[h2s.length - 1].text)) {
    conclusionScore = 2;
  }
  if (conclusionScore < 2) {
    issues.push({
      subScore: "structure",
      severity: "med",
      message: "No clear conclusion section.",
      suggestedFix: "End with an H2 titled Conclusion, Wrap-up, Summary, or Takeaways.",
    });
  }

  return {
    score: h1Score + h2Score + hierarchyScore + listScore + introScore + conclusionScore,
    max: 10,
    issues,
  };
}
