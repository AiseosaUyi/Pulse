// Deterministic half of Depth & Originality — 6 of 15 pts.
// Rubric v1 §4. Pure TS, no network.

import { countWords, withinTolerance } from "@/lib/blog/word-count";
import type { ScoreIssue } from "./types";

export interface DepthDetInputs {
  content: string;
  targetWordCount: number;
}

export interface DepthDetResult {
  /** 0-6 — contributes to the 15-pt depth sub-score. */
  score: number;
  max: 6;
  issues: ScoreIssue[];
  /** Raw specificity density so orchestrator can log/inspect. */
  specificityDensity: number;
  /** Signed deviation of actual vs target, e.g. -0.12 = 12% short. */
  wordOffset: number;
}

function specificityDensity(content: string, per500 = 500): number {
  const words = countWords(content);
  if (words === 0) return 0;
  const digits = (content.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
  // Proper noun heuristic: capitalized word not at sentence start.
  const proper = (content.match(/(?<![.!?]\s|^)\b[A-Z][a-z]{2,}\b/g) ?? []).length;
  return ((digits + proper) / words) * per500;
}

export function scoreDepthDeterministic(inp: DepthDetInputs): DepthDetResult {
  const issues: ScoreIssue[] = [];
  const actual = countWords(inp.content);

  // Word-count band — 3 pts
  let bandScore = 0;
  const offset = (actual - inp.targetWordCount) / inp.targetWordCount;
  const absOffset = Math.abs(offset);
  if (withinTolerance(actual, inp.targetWordCount, 0.1)) bandScore = 3;
  else if (absOffset <= 0.15) bandScore = 2;
  else if (absOffset <= 0.25) bandScore = 1;
  if (bandScore < 3) {
    issues.push({
      subScore: "depth",
      severity: bandScore === 0 ? "med" : "low",
      message: `Word count ${actual} vs target ${inp.targetWordCount} — off by ${(absOffset * 100).toFixed(0)}%.`,
      suggestedFix:
        actual < inp.targetWordCount
          ? "Add depth to undercovered sections (examples, edge cases)."
          : "Trim the filler — not every section needs to be long.",
    });
  }

  // Specificity density — 3 pts
  const density = specificityDensity(inp.content);
  let specScore = 0;
  if (density >= 8) specScore = 3;
  else if (density >= 5) specScore = 2;
  else if (density >= 2) specScore = 1;
  if (specScore < 3) {
    issues.push({
      subScore: "depth",
      severity: "low",
      message: `Only ${density.toFixed(1)} specific tokens (numbers, proper nouns) per 500 words.`,
      suggestedFix:
        "Replace abstract phrases with real numbers, brand names, places, or cited studies.",
    });
  }

  return {
    score: bandScore + specScore,
    max: 6,
    issues,
    specificityDensity: density,
    wordOffset: offset,
  };
}
