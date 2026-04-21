// Generate 3 fresh template variants when the current one goes
// stale or when the user wants alternatives to A/B-test. Same
// brand-voice + positioning layer as every other generation path.

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

export const templateVariantsSchema = z.object({
  variants: z
    .array(
      z.object({
        name: z
          .string()
          .max(60)
          .describe(
            "Short label describing the angle — 'social-proof open', 'event-signal hook', etc."
          ),
        angle: z
          .string()
          .max(160)
          .describe("One-sentence description of what this variant is doing."),
        body: z
          .string()
          .min(30)
          .describe("The actual DM body, ready to copy."),
      })
    )
    .length(3),
});

export type TemplateVariantsResult = z.infer<typeof templateVariantsSchema>;

export class TemplateGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "TemplateGenerationError";
  }
}

export interface GenerateTemplateInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  brief: {
    audience: string;
    angle: string;
    platform: TemplatePlatform;
    /** Optional: include the current primary template so the AI
     *  produces distinct variants, not near-duplicates. */
    avoidSimilarityTo?: string;
  };
}

export interface GenerateTemplateResult {
  variants: TemplateVariantsResult["variants"];
  model: string;
  costUsd: number;
}

const PLATFORM_LENGTH_HINT: Record<TemplatePlatform, string> = {
  any: "≤350 chars so it fits any DM box.",
  instagram: "≤400 chars, first 90 chars must stand alone.",
  tiktok: "≤300 chars, informal register.",
  twitter: "≤280 chars.",
  linkedin: "≤300 chars, professional register.",
};

export async function generateTemplateVariantsAi(
  input: GenerateTemplateInput
): Promise<GenerateTemplateResult> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystem(input);
  const user = buildUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: templateVariantsSchema }),
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
      feature: "template_generate",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return { variants: result.output.variants, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "template_generate",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new TemplateGenerationError("Failed to generate template variants", err);
  }
}

function buildSystem(input: GenerateTemplateInput): string {
  const { tenantName, voice, positioning, brief } = input;
  const lines = [
    `You write bulk outbound DM templates for ${tenantName}. Produce exactly 3 distinct variants that all match the brand voice but attack the outreach from different angles.`,
    "",
    "Rules (every variant must follow):",
    "- Personalization slot: use [FIRST_NAME] or [SIGNAL] tokens sparingly. These are templates, not hand-written — don't fake specificity.",
    "- First line earns the second. Weak hooks get deleted.",
    "- No 'Hi [name], I hope you're well'. Reads as spam.",
    "- One low-commitment CTA at the end. Not a pitch.",
    "- No price, no promise of outcomes, no implied existing relationship.",
    "- The 3 variants must be genuinely different — different opening line, different angle — not cosmetic rewrites of each other.",
    "",
    `Platform constraint: ${PLATFORM_LENGTH_HINT[brief.platform]}`,
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

function buildUser(input: GenerateTemplateInput): string {
  const { brief } = input;
  const lines = [
    `Platform: ${brief.platform}`,
    `Audience: ${brief.audience}`,
    `Angle / goal: ${brief.angle}`,
  ];
  if (brief.avoidSimilarityTo) {
    lines.push(
      "",
      "Your current template (produce variants that are meaningfully different from this one — different hook, different angle):",
      "---",
      brief.avoidSimilarityTo,
      "---"
    );
  }
  lines.push("", "Produce 3 distinct variants.");
  return lines.join("\n");
}
