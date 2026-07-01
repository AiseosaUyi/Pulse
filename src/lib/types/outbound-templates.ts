export const TEMPLATE_TYPES = [
  "cold_open",       // First ever message to a new lead
  "follow_up_1",     // 3–5 days after cold open, no reply
  "follow_up_2",     // 10–14 days after follow-up 1, last soft attempt
  "post_event",      // They just hosted/attended an event — strike while hot
  "event_confirmed", // They mentioned an upcoming event — follow up on it
  "promised_reminder", // They said "remind me" — here's that reminder
  "re_engagement",   // Weeks/months later, re-opening a cold lead
  "value_add",       // Share something useful — no ask, pure nurture
  "objection_response", // They had a concern — address it with value
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  cold_open: "First reachout",
  follow_up_1: "Follow-up 1",
  follow_up_2: "Follow-up 2",
  post_event: "Post-event",
  event_confirmed: "Event coming up",
  promised_reminder: "Promised reminder",
  re_engagement: "Re-engagement",
  value_add: "Value add",
  objection_response: "Objection response",
};

export const TEMPLATE_TYPE_DESCRIPTIONS: Record<TemplateType, string> = {
  cold_open: "Cold first message to a brand-new lead",
  follow_up_1: "3–5 days after no reply — gentle nudge",
  follow_up_2: "10–14 days — last soft attempt, leaves door open",
  post_event: "They just ran an event — reach out while it's fresh",
  event_confirmed: "They mentioned an upcoming event; follow up on it",
  promised_reminder: "They said 'remind me later' — here's that reminder",
  re_engagement: "Weeks later, re-opening a lead that went cold",
  value_add: "Share something useful — no ask, just goodwill",
  objection_response: "They pushed back; address the concern with value",
};

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
  templateType: TemplateType;
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
