import { generateText, Output } from "ai";
import { z } from "zod";
import { estimateCostUsd, getModel, getModelId, logAiCall } from "@/lib/ai/gateway";
import { buildPositioningBlock, type BrandPositioning } from "@/lib/ai/brand-positioning";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { TemplatePlatform } from "@/lib/types/outbound-templates";

const schema = z.object({
  body: z.string().min(20).describe("The rewritten DM body, ready to copy."),
});

export class PersonalizeTemplateError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "PersonalizeTemplateError";
  }
}

const PLATFORM_LENGTH_HINT: Record<TemplatePlatform, string> = {
  any: "≤350 chars so it fits any DM box.",
  instagram: "≤400 chars, first 90 chars must stand alone.",
  tiktok: "≤300 chars, informal register.",
  twitter: "≤280 chars.",
  linkedin: "≤300 chars, professional register.",
};

export async function personalizeTemplateAi(input: {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  globalBody: string;
  exampleMessages: string;
  direction: string;
  platform: TemplatePlatform;
}): Promise<{ body: string; model: string; costUsd: number }> {
  const { tenantSlug, tenantName, voice, positioning, globalBody, exampleMessages, direction, platform } = input;
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const systemLines = [
    `You are a DM copywriter for ${tenantName}. Rewrite a starting outreach template to match the user's natural voice and style while keeping it effective.`,
    "",
    "Rules:",
    "- Match the tone and register of their example messages as closely as possible.",
    "- Keep the core purpose of the original template intact.",
    "- Use tokens [FIRST_NAME], [HANDLE], [SIGNAL], [EVENT], [COMPANY] where appropriate.",
    "- No 'Hi [name], I hope you're well'. No fake specificity.",
    "- One low-commitment CTA at the end.",
    `Platform constraint: ${PLATFORM_LENGTH_HINT[platform]}`,
    "- Return only the message body — no quotes, no labels, no preamble.",
  ];
  if (voice) {
    systemLines.push(
      "",
      "Brand voice:",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`,
      `- Do: ${voice.do_list.join(" | ")}`,
      `- Don't: ${voice.dont_list.join(" | ")}`
    );
  }
  systemLines.push("", buildPositioningBlock(positioning));

  const userLines = [
    "Starting template to personalize:",
    "---",
    globalBody,
    "---",
  ];
  if (exampleMessages.trim()) {
    userLines.push("", "Example messages this user has sent before (their actual style):", "---", exampleMessages.trim(), "---");
  }
  if (direction.trim()) {
    userLines.push("", `What they want to change: ${direction.trim()}`);
  }
  userLines.push("", "Rewrite the template to match their voice. Return just the message body.");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema }),
      system: systemLines.join("\n"),
      prompt: userLines.join("\n"),
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cacheRead = ((result.providerMetadata?.openai ?? {}) as { cachedPromptTokens?: number }).cachedPromptTokens ?? 0;
    const costUsd = estimateCostUsd(modelId, { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, cacheReadTokens: cacheRead });

    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "template_personalize",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    return { body: result.output.body, model: modelId, costUsd };
  } catch (err) {
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "template_personalize",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new PersonalizeTemplateError("Failed to personalize template", err);
  }
}
