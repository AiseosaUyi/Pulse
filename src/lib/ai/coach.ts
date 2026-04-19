// AI Coach — converts any score / signal into prioritized "do this
// next" actions. One call synthesizes 2-5 actions and writes them
// into coach_actions. The UI reads from there and lets the user
// progress or dismiss each one.
//
// Coach is stateless per-call: takes a signal payload + brand
// context, returns actions. The caller persists the rows.

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
import type { CoachSourceType } from "@/lib/types/coach";

export const coachActionSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Punchy imperative verb + object (e.g. 'Rewrite the intro hook'). Max 80 chars preferred."
    ),
  description: z
    .string()
    .min(20)
    .max(600)
    .describe(
      "Why this matters and concretely what to do. 2-3 sentences. No fluff."
    ),
  impact_area: z
    .string()
    .describe(
      "One-word bucket: SEO, Content, Social, Brand, Distribution, Outbound, Analytics. Pick the best fit."
    ),
  priority: z
    .number()
    .int()
    .min(1)
    .max(3)
    .describe("1 = do today, 2 = this week, 3 = this month."),
  cta_label: z
    .string()
    .max(24)
    .describe("Short button label. 'Edit post', 'Draft brief', 'Review issue'."),
});

export const coachOutputSchema = z.object({
  actions: z.array(coachActionSchema).min(1).max(5),
});

export type CoachActionDraft = z.infer<typeof coachActionSchema>;

export class CoachError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "CoachError";
  }
}

export interface CoachGenerateInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  sourceType: CoachSourceType;
  /** Freeform signal payload — callers stringify the relevant fields. */
  signal: string;
  /** How many actions to aim for (default 3). */
  targetCount?: number;
}

export interface CoachGenerateResult {
  actions: CoachActionDraft[];
  model: string;
  costUsd: number;
}

export async function generateCoachActions(
  input: CoachGenerateInput
): Promise<CoachGenerateResult> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystem(input);
  const user = buildUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: coachOutputSchema }),
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
      feature: "coach_generate",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return {
      actions: result.output.actions,
      model: modelId,
      costUsd: cost,
    };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "coach_generate",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new CoachError("Failed to generate coach actions", err);
  }
}

function buildSystem(input: CoachGenerateInput): string {
  const { tenantName, voice, positioning, targetCount = 3 } = input;
  const lines: string[] = [
    `You are ${tenantName}'s head of marketing. A signal just came in — turn it into ${targetCount} concrete next actions the operator can take today.`,
    "",
    "Rules:",
    "- Be specific. 'Rewrite the intro hook to open with a stat' > 'Improve the intro'.",
    "- Every action must be something a single operator can start within 10 minutes.",
    "- Never recommend things we don't have — Pulse ships blog generation, content distribution, social publishing, competitor intel, brand audit, outbound DM drafting.",
    "- Priority 1 = urgent (drop what you're doing). Use sparingly.",
    "- Impact areas: SEO, Content, Social, Brand, Distribution, Outbound, Analytics.",
    "- Titles are imperative verbs. No 'Consider', no 'Maybe'.",
  ];
  if (voice) {
    lines.push(
      "",
      "Brand voice (so the coach sounds like the brand, not an LLM):",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`
    );
  }
  lines.push("", buildPositioningBlock(positioning));
  return lines.join("\n");
}

function buildUser(input: CoachGenerateInput): string {
  const { sourceType, signal, targetCount = 3 } = input;
  return [
    `Signal source: ${sourceType}`,
    "",
    "Signal payload:",
    signal,
    "",
    `Produce ${targetCount} actions.`,
  ].join("\n");
}
