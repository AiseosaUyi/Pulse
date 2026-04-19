export const COACH_SOURCE_TYPES = [
  "blog_score",
  "platform_score",
  "keyword_gap",
  "intel_signal",
  "weekly_digest",
  "competitor_move",
  "distribution_gap",
  "generic",
] as const;

export type CoachSourceType = (typeof COACH_SOURCE_TYPES)[number];

export type CoachStatus =
  | "pending"
  | "in_progress"
  | "snoozed"
  | "done"
  | "dismissed";

export interface CoachActionRecord {
  id: string;
  tenantSlug: string;
  sourceType: CoachSourceType;
  sourceId: string | null;
  title: string;
  description: string;
  impactArea: string;
  priority: 1 | 2 | 3;
  status: CoachStatus;
  snoozedUntil: string | null;
  dueAt: string | null;
  completedAt: string | null;
  actionHref: string | null;
  ctaLabel: string;
  createdByAi: boolean;
  generatorModel: string | null;
  generatorCostUsd: number;
  createdAt: string;
  updatedAt: string;
}
