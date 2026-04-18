// SEO Fundamentals sub-score — 20 pts, fully deterministic.
// Rubric v1 §2.

import { countWords } from "@/lib/blog/word-count";
import type { ScoreIssue, SubScoreResult } from "./types";

export interface SeoInputs {
  title: string;
  metaDescription: string | null;
  content: string;
  targetKeyword: string | null;
  secondaryKeywords: string[];
  slug?: string | null;
}

function rangeScore(n: number, best: [number, number], ok: [number, number], meh: [number, number]): number {
  if (n >= best[0] && n <= best[1]) return 3;
  if (n >= ok[0] && n <= ok[1]) return 2;
  if (n >= meh[0] && n <= meh[1]) return 1;
  return 0;
}

function includesI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Find the conclusion paragraph — heuristic: the content under the
 * last H2 OR the last ~20% of words. Used to check whether the target
 * keyword appears in the closing.
 */
function conclusionSlice(content: string): string {
  const lines = content.split("\n");
  const h2Idxs: number[] = [];
  lines.forEach((l, i) => {
    if (/^##\s+/.test(l)) h2Idxs.push(i);
  });
  if (h2Idxs.length > 0) {
    return lines.slice(h2Idxs[h2Idxs.length - 1]).join("\n");
  }
  // Fallback: last 20% of words.
  const words = content.split(/\s+/);
  const take = Math.max(50, Math.floor(words.length * 0.2));
  return words.slice(-take).join(" ");
}

function firstHundredWords(content: string): string {
  return content.split(/\s+/).slice(0, 100).join(" ");
}

export function scoreSeo(inp: SeoInputs): SubScoreResult {
  const issues: ScoreIssue[] = [];

  // 1. Title length
  const titleLen = inp.title.length;
  const titleScore = rangeScore(titleLen, [50, 60], [45, 65], [40, 70]);
  if (titleScore < 3) {
    issues.push({
      subScore: "seo",
      severity: titleScore === 0 ? "high" : "med",
      message: `Title is ${titleLen} chars — SEO sweet spot is 50-60.`,
      suggestedFix:
        titleLen > 60
          ? `Trim title by ${titleLen - 60} chars.`
          : `Expand title by ${50 - titleLen} chars.`,
      affectedSection: "title",
    });
  }

  // 2. Meta description length
  const metaLen = (inp.metaDescription ?? "").length;
  const metaScore = rangeScore(metaLen, [140, 160], [130, 170], [120, 180]);
  if (metaScore < 3) {
    issues.push({
      subScore: "seo",
      severity: metaScore === 0 ? "high" : "med",
      message: `Meta description is ${metaLen} chars — target 140-160.`,
      suggestedFix:
        metaLen > 160
          ? `Trim meta description to 140-160 chars.`
          : `Expand meta description to at least 140 chars.`,
      affectedSection: "meta",
    });
  }

  // 3. Target keyword placement (5 pts: 1 each for title, H1,
  //    first 100 words, any H2, conclusion)
  let placementScore = 0;
  const missing: string[] = [];
  if (inp.targetKeyword) {
    const kw = inp.targetKeyword;
    const content = inp.content;
    if (includesI(inp.title, kw)) placementScore++;
    else missing.push("title");

    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match && includesI(h1Match[1], kw)) placementScore++;
    else missing.push("H1");

    if (includesI(firstHundredWords(content), kw)) placementScore++;
    else missing.push("first 100 words");

    const h2Matches = content.match(/^##\s+.+$/gm) ?? [];
    if (h2Matches.some((h) => includesI(h, kw))) placementScore++;
    else missing.push("any H2");

    if (includesI(conclusionSlice(content), kw)) placementScore++;
    else missing.push("conclusion");
  }
  if (placementScore < 5 && inp.targetKeyword) {
    issues.push({
      subScore: "seo",
      severity: placementScore <= 2 ? "high" : "med",
      message: `Target keyword "${inp.targetKeyword}" missing from: ${missing.join(", ")}.`,
      suggestedFix: `Work the keyword naturally into ${missing.join(", ")} without stuffing.`,
    });
  }

  // 4. Keyword density
  let densityScore = 0;
  if (inp.targetKeyword) {
    const total = countWords(inp.content);
    if (total > 0) {
      const pattern = new RegExp(
        inp.targetKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi"
      );
      const matches = (inp.content.match(pattern) ?? []).length;
      const density = (matches / total) * 100;
      if (density >= 0.5 && density <= 2.5) densityScore = 3;
      else if ((density >= 0.3 && density < 0.5) || (density > 2.5 && density <= 3.5))
        densityScore = 2;
      else if (density > 0) densityScore = 0;

      if (densityScore < 3) {
        issues.push({
          subScore: "seo",
          severity: densityScore === 0 ? "high" : "low",
          message: `Keyword density ${density.toFixed(2)}% — target 0.5-2.5%.`,
          suggestedFix:
            density < 0.5
              ? `Mention the keyword a few more times (naturally).`
              : `Keyword is stuffed — paraphrase some mentions.`,
        });
      }
    }
  }

  // 5. Secondary keywords used
  let secondaryScore = 0;
  if (inp.secondaryKeywords.length > 0) {
    const found = inp.secondaryKeywords.filter((kw) =>
      includesI(inp.content, kw)
    ).length;
    if (found >= 2) secondaryScore = 3;
    else if (found === 1) secondaryScore = 1;
    else secondaryScore = 0;

    if (secondaryScore < 3) {
      const missingKw = inp.secondaryKeywords.filter(
        (kw) => !includesI(inp.content, kw)
      );
      issues.push({
        subScore: "seo",
        severity: "med",
        message: `Only ${found}/${inp.secondaryKeywords.length} secondary keywords appear in the body.`,
        suggestedFix: `Weave in: ${missingKw.slice(0, 3).join(", ")}${missingKw.length > 3 ? "…" : ""}.`,
      });
    }
  } else {
    // No secondary keywords defined — full marks (can't penalize absence).
    secondaryScore = 3;
  }

  // 6. Slug
  let slugScore = 0;
  if (inp.slug) {
    const slug = inp.slug.toLowerCase();
    const hasOnlyAllowed = /^[a-z0-9-]+$/.test(slug);
    const lenOk = slug.length <= 75;
    const hasKeywordPart =
      !inp.targetKeyword ||
      inp.targetKeyword
        .toLowerCase()
        .split(/\s+/)
        .some((tok) => tok.length > 3 && slug.includes(tok));
    if (lenOk && hasOnlyAllowed && hasKeywordPart) slugScore = 3;
    else if (lenOk && hasOnlyAllowed) slugScore = 2;
    else slugScore = 0;

    if (slugScore < 3) {
      issues.push({
        subScore: "seo",
        severity: slugScore === 0 ? "med" : "low",
        message: `Slug "${slug}" needs work: ${!hasOnlyAllowed ? "format (use only a-z0-9-); " : ""}${!lenOk ? `length (${slug.length} > 75); ` : ""}${!hasKeywordPart ? "doesn't include any keyword word" : ""}`.trim(),
        suggestedFix: `Use a lowercase hyphenated slug ≤75 chars that includes part of the target keyword.`,
      });
    }
  } else {
    // No slug yet — don't penalize pre-publish drafts. Counts as 0
    // but is flagged as low severity so the author is reminded.
    issues.push({
      subScore: "seo",
      severity: "low",
      message: "No URL slug set yet.",
      suggestedFix: "Set a slug before publishing — 3 pts available.",
    });
  }

  const score =
    titleScore +
    metaScore +
    placementScore +
    densityScore +
    secondaryScore +
    slugScore;

  return { score, max: 20, issues };
}
