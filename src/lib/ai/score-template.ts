// Outbound template critic. Priye pastes her bulk DM template —
// the one she'd send to every prospect today — and we score it
// like Ads Critic scores ad creative: hook, clarity, voice fit,
// platform fit, CTA. Plus a ship-ready rewrite.

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";
import type { TemplatePlatform } from "@/lib/types/outbound-templates";

export const templateCritiqueSchema = z.object({
  overall_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("0-100. 90+ = ship, 70-89 = polish, <70 = rewrite."),
  hook_score: z.number().int().min(0).max(10),
  clarity_score: z.number().int().min(0).max(10),
  voice_fit_score: z.number().int().min(0).max(10),
  platform_fit_score: z.number().int().min(0).max(10),
  cta_score: z.number().int().min(0).max(10),
  strengths: z.array(z.string()).min(1).max(4),
  weaknesses: z.array(z.string()).min(1).max(5),
  failure_modes: z
    .array(
      z.object({
        issue: z.string(),
        why_it_hurts_reply_rate: z
          .string()
          .describe(
            "Concrete mechanism — 'opens with generic Hi → reads as spam → IG filters it or prospect ignores'."
          ),
      })
    )
    .max(5),
  rewrite: z
    .string()
    .describe(
      "A single ready-to-ship rewrite. Same platform, same purpose, same audience — just better."
    ),
  verdict: z
    .enum(["ship_as_is", "polish", "rewrite", "kill"])
    .describe(
      "ship_as_is = ≥90. polish = 70-89. rewrite = 50-69. kill = <50."
    ),
  verdict_reason: z.string().describe("One sentence explaining the verdict."),
});

export type TemplateCritiqueResult = z.infer<typeof templateCritiqueSchema>;

export class TemplateCritiqueError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "TemplateCritiqueError";
  }
}

export interface ScoreTemplateInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  template: {
    platform: TemplatePlatform;
    body: string;
    angle?: string | null;
  };
}

export interface ScoreTemplateResult {
  critique: TemplateCritiqueResult;
  model: string;
  costUsd: number;
}

const PLATFORM_CONSTRAINTS: Record<TemplatePlatform, string> = {
  any: "Keep under 350 chars so it fits any DM box.",
  instagram:
    "IG DMs from non-followers are heavily throttled. Under 400 chars. First 90 chars must stop the scroll — longer text gets truncated in the inbox preview.",
  tiktok: "TikTok DMs under 300 chars. Very informal register.",
  twitter: "Twitter DMs under 280 chars.",
  linkedin:
    "LinkedIn connection notes cap at 300 chars. Professional register, skip emoji unless the brand voice says otherwise.",
};

export async function scoreTemplateAi(
  input: ScoreTemplateInput
): Promise<ScoreTemplateResult> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystem(input);
  const user = buildUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: templateCritiqueSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cacheRead =
      ((result.providerMetadata?.openai ?? {}) as { cachedPromptTokens?: number })
        .cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "template_score",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return { critique: result.output, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "template_score",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new TemplateCritiqueError("Failed to score template", err);
  }
}

function buildSystem(input: ScoreTemplateInput): string {
  const { tenantName, voice, positioning, template } = input;
  const lines = [
    `You are ${tenantName}'s head of outbound. You critique cold DM templates ruthlessly — low reply rate = wasted hours.`,
    "",
    "Known reply-rate killers to check against:",
    "- Generic openers ('Hi [name], hope you're well') signal marketing → ignored.",
    "- No personalization hook: reader sees this as a blast → ignored.",
    "- Vague CTA ('let me know'): even interested replies fizzle. Concrete, low-commitment CTA wins.",
    "- Wrong platform register (LinkedIn-formal on TikTok, emoji on LinkedIn) reads as uncanny → ignored.",
    "- Over-pitching in the first message: ask a question, don't pitch the product.",
    "- Length that exceeds platform truncation: first 90 chars on IG, 160 on LinkedIn — anything past that must stand alone.",
    "",
    "Scoring rubric:",
    "- 10 = category-leading, reuse as-is. 7-9 = strong. 5-6 = mediocre. <5 = actively hurting reply rate.",
    "- Be honest. Don't round up. Operators lose real hours when you're polite.",
    "",
    `Platform constraint: ${PLATFORM_CONSTRAINTS[template.platform]}`,
  ];
  if (voice) {
    lines.push(
      "",
      "Brand voice (must match):",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`,
      `- Do: ${voice.do_list.join(" | ")}`,
      `- Don't: ${voice.dont_list.join(" | ")}`
    );
  }
  lines.push("", buildPositioningBlock(positioning));
  return lines.join("\n");
}

function buildUser(input: ScoreTemplateInput): string {
  const { template } = input;
  return [
    `Platform: ${template.platform}`,
    template.angle ? `Angle / use case: ${template.angle}` : "",
    "",
    "Template body:",
    "---",
    template.body,
    "---",
    "",
    "Score, critique, and rewrite.",
  ]
    .filter(Boolean)
    .join("\n");
}
