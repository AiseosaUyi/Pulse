// Deterministic half of Brand Alignment — a -5 cap when any banned
// topic appears in the post. No positive points to give, only a cap
// that applies AFTER the AI's 20-pt rating. Rubric v1 §1.

import type { ScoreIssue } from "./types";
import type { BrandPositioning } from "@/lib/ai/brand-positioning";

export interface AlignmentDetInputs {
  title: string;
  content: string;
  positioning: BrandPositioning | null;
}

export interface AlignmentDetResult {
  /** Non-positive penalty applied to alignment total. 0 when clean, -5 on match. */
  penalty: number;
  /** The matched banned topic string, or null when clean. */
  bannedTopicHit: string | null;
  issues: ScoreIssue[];
}

function includesAnyCI(haystack: string, needles: string[]): string | null {
  const low = haystack.toLowerCase();
  for (const n of needles) {
    if (n.trim().length === 0) continue;
    if (low.includes(n.toLowerCase())) return n;
  }
  return null;
}

export function scoreAlignmentDeterministic(
  inp: AlignmentDetInputs
): AlignmentDetResult {
  const issues: ScoreIssue[] = [];

  if (
    !inp.positioning ||
    inp.positioning.topics_to_avoid.length === 0
  ) {
    return { penalty: 0, bannedTopicHit: null, issues };
  }

  const hit = includesAnyCI(
    `${inp.title}\n${inp.content}`,
    inp.positioning.topics_to_avoid
  );

  if (!hit) return { penalty: 0, bannedTopicHit: null, issues };

  issues.push({
    subScore: "alignment",
    severity: "high",
    message: `Post mentions a banned topic: "${hit}".`,
    suggestedFix: `Remove references to "${hit}" — it's in your topics_to_avoid list.`,
  });

  return { penalty: -5, bannedTopicHit: hit, issues };
}
