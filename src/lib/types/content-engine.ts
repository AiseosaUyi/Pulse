// Types for the Content Engine — format-driven video plan generation.
// Tables live in 039_content_engine.sql.

export type ContentMedium = "video";
export type ContentFormatScope = "platform" | "tenant";

export interface ContentFormatTemplate {
  id: string;
  scope: ContentFormatScope;
  tenantSlug: string | null;
  parentTemplateId: string | null;
  medium: ContentMedium;
  name: string;
  description: string | null;
  category: string | null;
  durationMin: number;
  durationMax: number;
  structure: string[];
  tone: string | null;
  defaultScenes: number;
  exampleHook: string | null;
  exampleScript: string | null;
  isActive: boolean;
  lastGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPlanScene {
  scene: number;
  description: string;
  dialogue: string | null;
  camera: string;
  emotion: string;
}

export interface ContentPlanOutput {
  hook: string;
  durationSeconds: number;
  scenes: ContentPlanScene[];
  tone: string;
  readyPrompt: string;
}

export type SuggestedTool = "seedance" | "kling" | "manual" | "capcut";
export type ContentPlanStatus = "draft" | "approved" | "used" | "dismissed";
export type ContentPlanFeedback = "none" | "good" | "bad";

export interface ContentPlan {
  id: string;
  tenantSlug: string;
  templateId: string | null;
  templateName: string;
  templateCategory: string | null;
  medium: ContentMedium;
  platform: string;
  output: ContentPlanOutput;
  predictedVirality: number | null;
  predictedEducation: number | null;
  predictedConversion: number | null;
  suggestedTool: SuggestedTool | null;
  suggestedToolReason: string | null;
  status: ContentPlanStatus;
  feedback: ContentPlanFeedback;
  feedbackNotes: string | null;
  generatorModel: string | null;
  generatorCostUsd: number | null;
  batchId: string;
  createdAt: string;
  updatedAt: string;
}

export const PLAN_PLATFORMS = [
  "tiktok",
  "instagram",
  "reels",
  "youtube_shorts",
] as const;
export type PlanPlatform = (typeof PLAN_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<PlanPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  reels: "Reels",
  youtube_shorts: "YouTube Shorts",
};

export const TOOL_LABELS: Record<SuggestedTool, string> = {
  seedance: "Seedance",
  kling: "Kling",
  manual: "Manual / Real footage",
  capcut: "CapCut",
};
