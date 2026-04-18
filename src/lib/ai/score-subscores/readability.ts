// Readability sub-score — 15 pts, fully deterministic.
// Rubric v1 §3: Flesch + sentence len + paragraph len + passive rate.

import type { ScoreIssue, SubScoreResult } from "./types";

export interface ReadabilityInputs {
  /** Markdown content — we strip to plain text internally. */
  content: string;
}

function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

/**
 * Approximate syllable count — conventional Flesch-Kincaid heuristic.
 * Groups of consecutive vowels count as one syllable; trailing silent
 * "e" is stripped. Good enough for English.
 */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  const groups = stripped.match(/[aeiouy]+/g);
  return groups ? groups.length : 1;
}

function countSentences(text: string): number {
  // Split on terminal punctuation followed by whitespace or EOL.
  // Handles "Mr. Smith" poorly but good enough at paragraph scale.
  const hits = text.match(/[.!?]+(?=\s|$)/g);
  return hits ? hits.length : 0;
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
}

export function fleschReadingEase(content: string): number {
  const text = toPlainText(content);
  const words = splitWords(text);
  const sentences = Math.max(1, countSentences(text));
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  if (words.length === 0) return 0;
  const avgSentLen = words.length / sentences;
  const avgSyllables = syllables / words.length;
  // Standard FKRE formula.
  return 206.835 - 1.015 * avgSentLen - 84.6 * avgSyllables;
}

function fleschScore(flesch: number): number {
  // 60-80 = best (8). Linear falloff outside.
  if (flesch >= 60 && flesch <= 80) return 8;
  if (flesch >= 50 && flesch < 60) return 5 + (3 * (flesch - 50)) / 10;
  if (flesch > 80 && flesch <= 85) return 5 + (3 * (85 - flesch)) / 5;
  if (flesch >= 40 && flesch < 50) return 2 + (3 * (flesch - 40)) / 10;
  if (flesch > 85 && flesch <= 90) return 2 + (3 * (90 - flesch)) / 5;
  return 0;
}

function countPassive(text: string): number {
  // Heuristic: auxiliary verb + past participle.
  // Picks up most English passive constructions.
  const re = /\b(?:is|was|were|been|being|are|am)\s+\w+(?:ed|en|own|orn|ung|one|ought|aught)\b/gi;
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

export function scoreReadability(inp: ReadabilityInputs): SubScoreResult {
  const issues: ScoreIssue[] = [];
  const text = toPlainText(inp.content);
  const words = splitWords(text);
  const sentences = Math.max(1, countSentences(text));

  // Flesch
  const flesch = fleschReadingEase(inp.content);
  const fkScore = Math.round(fleschScore(flesch));
  if (fkScore < 7) {
    issues.push({
      subScore: "readability",
      severity: fkScore === 0 ? "high" : "med",
      message: `Flesch Reading Ease ${flesch.toFixed(0)} — sweet spot 60-80.`,
      suggestedFix:
        flesch < 60
          ? "Shorten sentences and swap some long words for shorter ones."
          : "Writing feels too simple for the audience — add specificity.",
    });
  }

  // Sentence length
  const avgSentLen = words.length / sentences;
  let sentScore = 0;
  if (avgSentLen >= 14 && avgSentLen <= 20) sentScore = 3;
  else if ((avgSentLen >= 10 && avgSentLen < 14) || (avgSentLen > 20 && avgSentLen <= 25))
    sentScore = 2;
  else if ((avgSentLen >= 6 && avgSentLen < 10) || (avgSentLen > 25 && avgSentLen <= 30))
    sentScore = 1;
  if (sentScore < 3) {
    issues.push({
      subScore: "readability",
      severity: sentScore === 0 ? "med" : "low",
      message: `Average sentence length ${avgSentLen.toFixed(1)} words — target 14-20.`,
      suggestedFix:
        avgSentLen > 20
          ? "Break some long sentences into two."
          : "Combine some choppy sentences for rhythm.",
    });
  }

  // Paragraph length (in sentences)
  const paras = inp.content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const paraSentCounts = paras.map((p) => countSentences(toPlainText(p))).filter((n) => n > 0);
  const avgParaSent =
    paraSentCounts.length > 0
      ? paraSentCounts.reduce((a, b) => a + b, 0) / paraSentCounts.length
      : 0;
  let paraScore = 0;
  if (avgParaSent <= 4) paraScore = 2;
  else if (avgParaSent <= 5) paraScore = 1;
  if (paraScore < 2) {
    issues.push({
      subScore: "readability",
      severity: "low",
      message: `Paragraphs average ${avgParaSent.toFixed(1)} sentences — keep under 4 for web readers.`,
      suggestedFix: "Break dense paragraphs into 2-3 sentence chunks.",
    });
  }

  // Passive voice
  const passiveCount = countPassive(text);
  const passiveRate = sentences > 0 ? passiveCount / sentences : 0;
  let passiveScore = 0;
  if (passiveRate < 0.15) passiveScore = 2;
  else if (passiveRate < 0.25) passiveScore = 1;
  if (passiveScore < 2) {
    issues.push({
      subScore: "readability",
      severity: passiveScore === 0 ? "med" : "low",
      message: `Passive voice ~${(passiveRate * 100).toFixed(0)}% — prefer active.`,
      suggestedFix: "Rewrite passive sentences with a clear subject performing the action.",
    });
  }

  return {
    score: fkScore + sentScore + paraScore + passiveScore,
    max: 15,
    issues,
  };
}
