import { generateText, Output } from "ai";
import { z } from "zod";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { PatternCluster } from "@/lib/ai/group-patterns";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";

export const briefSchema = z.object({
  title: z.string().min(1),
  outline: z.array(z.string()).min(1),
  draftContent: z.string().min(10),
  seoKeywords: z.array(z.string()),
});

export type GeneratedBrief = z.infer<typeof briefSchema>;

export class BriefGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "BriefGenerationError";
  }
}

interface GenerateBriefInput {
  tenantSlug: string;
  tenantName: string;
  cluster: PatternCluster;
  voice: BrandVoice;
}

export async function generateBrief(
  input: GenerateBriefInput
): Promise<GeneratedBrief> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystemPrompt(input);
  const user = buildUserPrompt(input);

  try {
    // OpenAI prompt caching is automatic on stable system prompts ≥1024 tokens.
    // No providerOptions needed; cache tokens come back in providerMetadata.openai.
    const result = await generateText({
      model,
      output: Output.object({ schema: briefSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = meta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
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
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BriefGenerationError("Failed to generate brief", err);
  }
}

function buildSystemPrompt(input: GenerateBriefInput): string {
  const { tenantName, voice } = input;
  return [
    `You generate content briefs for ${tenantName}.`,
    "",
    "Brand voice:",
    `- Tone: ${voice.tone}`,
    `- Audience: ${voice.audience}`,
    `- Do: ${voice.do_list.join(" | ")}`,
    `- Don't: ${voice.dont_list.join(" | ")}`,
    "",
    "Examples of our voice:",
    ...voice.example_posts.map((p, i) => `  ${i + 1}. ${p}`),
    "",
    "If a brief has no SEO keywords (e.g. social-only content), return seoKeywords as an empty array.",
  ].join("\n");
}

function buildUserPrompt(input: GenerateBriefInput): string {
  const { cluster } = input;
  const topCards = cluster.cards.slice(0, 3);
  return [
    `You observed a competitor-activity pattern this week:`,
    `Pattern: ${cluster.name} (avg engagement vs baseline: ${cluster.avgVsAverage.toFixed(1)}x)`,
    "",
    "Top posts:",
    ...topCards.map(
      (c, i) =>
        `${i + 1}. ${c.competitorName} on ${c.platform} (${c.contentType}): ${c.summary} — engagement rate ${c.metrics.engagementRate}%, vs avg ${c.metrics.vsAverage ?? "n/a"}x`
    ),
    "",
    `Task: draft a content brief that applies this pattern to us. Stay true to our voice.`,
  ].join("\n");
}
