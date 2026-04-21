export const TEMPLATE_PLATFORMS = [
  "any",
  "instagram",
  "tiktok",
  "twitter",
  "linkedin",
] as const;

export type TemplatePlatform = (typeof TEMPLATE_PLATFORMS)[number];

export type TemplateStatus = "active" | "archived" | "draft";

export interface TemplateCritique {
  overall_score: number;
  hook_score: number;
  clarity_score: number;
  voice_fit_score: number;
  platform_fit_score: number;
  cta_score: number;
  strengths: string[];
  weaknesses: string[];
  failure_modes: Array<{
    issue: string;
    why_it_hurts_reply_rate: string;
  }>;
  rewrite: string;
  verdict: "ship_as_is" | "polish" | "rewrite" | "kill";
  verdict_reason: string;
}

export interface OutboundTemplateRecord {
  id: string;
  tenantSlug: string;
  name: string;
  platform: TemplatePlatform;
  body: string;
  angle: string | null;
  status: TemplateStatus;
  isPrimary: boolean;
  score: number | null;
  lastCritique: TemplateCritique | null;
  lastScoredAt: string | null;
  generatorModel: string | null;
  generatorCostUsd: number;
  parentTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TEMPLATE_PLATFORM_LABELS: Record<TemplatePlatform, string> = {
  any: "Any platform",
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
};
