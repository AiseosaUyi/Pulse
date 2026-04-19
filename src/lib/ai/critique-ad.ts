// Ad Creative Critic — the one genuinely cost-reducing feature we can
// ship on an ads tab without piping in platform data. Operator pastes
// a running ad's headline + body + CTA + audience note, AI critiques
// against known winning patterns + the brand's voice. Output: scores,
// failure modes, and rewrite suggestions.
//
// Doesn't touch Meta/TikTok APIs — fully self-contained.

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

export const AD_PLATFORMS = [
  "meta_facebook",
  "meta_instagram",
  "tiktok",
  "youtube",
  "google_search",
  "linkedin",
  "other",
] as const;

export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_OBJECTIVES = [
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "sales",
  "app_install",
] as const;

export type AdObjective = (typeof AD_OBJECTIVES)[number];

export const adCritiqueSchema = z.object({
  overall_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("0-100. 90+ = ship, 70-89 = polish, <70 = rewrite."),
  hook_score: z.number().int().min(0).max(10),
  clarity_score: z.number().int().min(0).max(10),
  cta_score: z.number().int().min(0).max(10),
  brand_fit_score: z.number().int().min(0).max(10),
  platform_fit_score: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "How well the creative matches platform norms (TikTok hook cadence, LinkedIn professional register, etc)."
    ),
  strengths: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe("What's working. Specific."),
  weaknesses: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("What's hurting ROAS. Specific."),
  failure_modes: z
    .array(
      z.object({
        issue: z.string(),
        why_it_hurts_cost: z
          .string()
          .describe(
            "Concrete mechanism — 'generic hook → lower CTR → Meta pushes lower quality impressions → higher CPM'."
          ),
      })
    )
    .max(5),
  rewrites: z
    .object({
      headline: z.string(),
      primary_text: z.string(),
      cta: z.string(),
    })
    .describe("A single ready-to-ship rewrite of the whole ad."),
  verdict: z
    .enum(["ship_as_is", "polish", "pause_and_rewrite", "kill"])
    .describe(
      "ship_as_is = ≥90. polish = 70-89. pause_and_rewrite = 50-69. kill = <50."
    ),
  verdict_reason: z
    .string()
    .describe("One sentence explaining the verdict."),
});

export type AdCritique = z.infer<typeof adCritiqueSchema>;

export class AdCritiqueError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "AdCritiqueError";
  }
}

export interface CritiqueAdInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  ad: {
    platform: AdPlatform;
    objective: AdObjective;
    headline: string;
    primaryText: string;
    cta: string;
    audience?: string;
    /** Text description of the visual — "product shot with founder smiling". */
    visual_description?: string;
    /** Optional: current performance hint. "CTR is 0.6%, CPM is $38". */
    current_performance?: string;
  };
}

export interface CritiqueAdResult {
  critique: AdCritique;
  model: string;
  costUsd: number;
}

export async function critiqueAd(
  input: CritiqueAdInput
): Promise<CritiqueAdResult> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystem(input);
  const user = buildUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: adCritiqueSchema }),
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
      feature: "ad_critique",
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
      feature: "ad_critique",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new AdCritiqueError("Failed to critique ad", err);
  }
}

function buildSystem(input: CritiqueAdInput): string {
  const { tenantName, voice, positioning } = input;
  const lines = [
    `You are ${tenantName}'s paid-media strategist with 10 years running Meta and TikTok ads. You critique ad creative ruthlessly — the operator pays per click, so weak creative = burned budget.`,
    "",
    "Known cost-drivers to check against:",
    "- Hook strength: if the first 1.5s doesn't stop the scroll, everything downstream suffers",
    "- Specificity: generic copy gets punished by platform quality scores",
    "- Offer clarity: unclear CTAs raise CPA by 20-40%",
    "- Brand-platform fit: polished LinkedIn-tone on TikTok = underperform",
    "- Claim credibility: unsupported claims trigger Meta's 'low quality' classifier",
    "",
    "Scoring rubric:",
    "- 10 = category-leading, save and reuse. 7-9 = strong. 5-6 = mediocre. <5 = killing spend.",
    "- Be honest. Don't round up. Operators lose real money when you're polite.",
  ];
  if (voice) {
    lines.push(
      "",
      "Brand voice:",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`,
      `- Do: ${voice.do_list.join(" | ")}`,
      `- Don't: ${voice.dont_list.join(" | ")}`
    );
  }
  lines.push("", buildPositioningBlock(positioning));
  return lines.join("\n");
}

function buildUser(input: CritiqueAdInput): string {
  const { ad } = input;
  const lines = [
    `Platform: ${ad.platform}`,
    `Objective: ${ad.objective}`,
    "",
    `Headline: ${ad.headline}`,
    `Primary text: ${ad.primaryText}`,
    `CTA: ${ad.cta}`,
  ];
  if (ad.audience) lines.push(`Audience: ${ad.audience}`);
  if (ad.visual_description) lines.push(`Visual: ${ad.visual_description}`);
  if (ad.current_performance)
    lines.push(`Current performance: ${ad.current_performance}`);
  lines.push("", "Critique and rewrite.");
  return lines.join("\n");
}
