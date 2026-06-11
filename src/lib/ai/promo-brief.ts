// Promo / offer brief generator. Given a product + price + window, produces
// channel-native copy (IG caption, story line, WhatsApp broadcast) in the
// brand voice. Separate from generate-brief.ts so the pattern-driven brief
// path is untouched. Logs telemetry like every other AI call.

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import {
  getBrandContext,
  buildPositioningBlock,
} from "@/lib/ai/brand-positioning";

export const promoBriefSchema = z.object({
  ig_caption: z
    .string()
    .min(1)
    .describe("Instagram feed/Reel caption with a clear CTA. Includes the CTA URL placeholder {link} where the link should go."),
  story_copy: z
    .string()
    .min(1)
    .describe("Short punchy Instagram story overlay text — under 90 chars."),
  whatsapp_broadcast: z
    .string()
    .min(1)
    .describe("WhatsApp broadcast message. Warm, direct, includes the offer + {link}."),
  cta_text: z.string().min(1).describe("Button/CTA microcopy, e.g. 'Order now'."),
});

export type PromoBrief = z.infer<typeof promoBriefSchema>;

export class PromoBriefError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "PromoBriefError";
  }
}

export interface PromoBriefInput {
  tenantSlug: string;
  tenantName: string;
  product: string;
  price?: string | null;
  discount?: string | null;
  offer: string; // the headline offer, e.g. "Buy 2 get 1 free this weekend"
  expiresAt?: string | null; // ISO or human window
}

export async function generatePromoBrief(
  input: PromoBriefInput
): Promise<PromoBrief> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const { voice, positioning } = await getBrandContext(input.tenantSlug);

  const system = [
    `You are ${input.tenantName}'s social marketer. Write promo copy that drives orders now.`,
    "Rules: lead with the offer, create urgency from the deadline, one clear CTA.",
    "Keep it native to each channel. Put the link placeholder exactly as {link}.",
    voice ? `Tone: ${voice.tone}. Audience: ${voice.audience}.` : "",
    buildPositioningBlock(positioning),
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Product: ${input.product}`,
    input.price ? `Price: ${input.price}` : "",
    input.discount ? `Discount: ${input.discount}` : "",
    `Offer: ${input.offer}`,
    input.expiresAt ? `Expires: ${input.expiresAt}` : "",
    "",
    "Write the promo copy.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: promoBriefSchema }),
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
      feature: "promo_brief",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "promo_brief",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new PromoBriefError("Failed to generate promo brief", err);
  }
}
