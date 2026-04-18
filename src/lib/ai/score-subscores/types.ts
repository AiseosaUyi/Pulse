// Shared types for the scoring engine. Every sub-scorer returns one of
// these so the orchestrator doesn't branch per sub-score.

export type SubScoreKey =
  | "alignment"
  | "seo"
  | "readability"
  | "depth"
  | "structure"
  | "faq"
  | "eeat";

export interface ScoreIssue {
  subScore: SubScoreKey;
  severity: "high" | "med" | "low";
  message: string;
  suggestedFix: string;
  affectedSection?: string;
}

export interface SubScoreResult {
  /** 0 to max (per rubric weights). */
  score: number;
  /** Weight from rubric v1 — so `score / max === pct`. */
  max: number;
  issues: ScoreIssue[];
}
