// Engage AI — given a post you want to react to, draft both a quote-post take
// and a direct reply, in the brand's voice. One structured-output call. Reuses
// the brand voice + positioning layer like every other AI call site.

import { generateText, Output } from "ai";
import { z } from "zod";
import { estimateCostUsd, getModel, getModelId, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import { buildPositioningBlock, type BrandPositioning } from "@/lib/ai/brand-positioning";
import { stripBannedDashes } from "@/lib/blog/content-flags";

export const engageDraftSchema = z.object({
  quote: z
    .string()
    .min(1)
    .max(2000)
    .describe("A quote-post: the take you'd post above the shared post, adding your angle."),
  reply: z
    .string()
    .min(1)
    .max(2000)
    .describe("A direct, in-conversation reply — concise and additive, not a restatement."),
});

export type EngageDraft = z.infer<typeof engageDraftSchema>;

export class EngageAiError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "EngageAiError";
  }
}

export interface EngageInput {
  tenantSlug: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  /** The post the user wants to engage with. */
  postText: string;
  /** Author handle, if known. */
  fromHandle?: string | null;
}

export async function draftEngagementAi(
  input: EngageInput
): Promise<{ result: EngageDraft; model: string; costUsd: number }> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const lines = [
    "You help someone engage on social in their authentic voice. Given a post they want to react to, draft TWO things: a quote-post take (their angle, posted above the share) and a direct reply.",
    "",
    "Hard rules:",
    "- Match the brand voice: tone, do's, don'ts, the cadence of the example posts.",
    "- Add a real point of view — agree-and-extend, respectfully push back, or add a concrete example. Never empty praise ('Great post!').",
    "- Tight and specific. No hashtags/emoji unless the example posts use them. No 'in today's world' openers.",
    "- A design-literate reader must not smell generated copy.",
    "- Return ONLY the text in each field — no preamble, no quotation marks.",
  ];
  if (input.voice) {
    lines.push(
      "",
      "Brand voice:",
      `- Tone: ${input.voice.tone}`,
      `- Audience: ${input.voice.audience}`,
      `- Do: ${input.voice.do_list.join("; ")}`,
      `- Don't: ${input.voice.dont_list.join("; ")}`,
      "- Example posts (match this cadence):",
      ...input.voice.example_posts.slice(0, 5).map((p) => `    • ${p}`)
    );
  }
  lines.push("", buildPositioningBlock(input.positioning));
  const system = lines.join("\n");

  const user = [
    input.fromHandle ? `Post by ${input.fromHandle}:` : "Post:",
    input.postText,
    "",
    "Draft the quote-post take and the reply now.",
  ].join("\n");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: engageDraftSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "engage_draft",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    const cleaned: EngageDraft = {
      quote: stripBannedDashes(result.output.quote, input.voice),
      reply: stripBannedDashes(result.output.reply, input.voice),
    };
    return { result: cleaned, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "engage_draft",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new EngageAiError("Failed to draft engagement", err);
  }
}
