// Drafts a reply to an inbound comment/DM in the brand voice, for the
// approval queue. The marketer reviews/edits before it's sent — nothing
// auto-sends. Logs telemetry like every AI call.

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
import { stripBannedDashes } from "@/lib/blog/content-flags";

export const replyDraftSchema = z.object({
  body: z.string().min(1).describe("The reply, ready to send. No preamble."),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe("How safe this is to send as-is."),
});

export type ReplyDraft = z.infer<typeof replyDraftSchema>;

export interface ReplyDraftInput {
  tenantSlug: string;
  tenantName: string;
  item: {
    type: string;
    platform: string;
    content: string;
    fromHandle: string | null;
  };
}

export async function generateEngagementReplyDraft(
  input: ReplyDraftInput
): Promise<ReplyDraft> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();
  const { voice, positioning } = await getBrandContext(input.tenantSlug);

  const system = [
    `You are ${input.tenantName} replying to customers on ${input.item.platform}.`,
    "Be warm, concise, on-brand. If it's a question, answer it. If it's an order intent, nudge them to order. Never over-promise.",
    "Never invent statistics, delivery/time guarantees, named customer testimonials, or competitor prices.",
    voice ? `Tone: ${voice.tone}. Audience: ${voice.audience}.` : "",
    voice?.do_list.length ? `Do: ${voice.do_list.join("; ")}.` : "",
    voice?.dont_list.length ? `Don't: ${voice.dont_list.join("; ")}.` : "",
    buildPositioningBlock(positioning),
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Inbound ${input.item.type} from ${input.item.fromHandle ?? "a customer"}:`,
    `"${input.item.content}"`,
    "",
    "Draft the reply.",
  ].join("\n");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: replyDraftSchema }),
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
      feature: "engagement_reply_draft",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return {
      ...result.output,
      body: stripBannedDashes(result.output.body, voice),
    };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "engagement_reply_draft",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
