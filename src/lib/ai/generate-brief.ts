import { generateText, Output } from "ai";
import { z } from "zod";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { PatternCluster } from "@/lib/ai/group-patterns";
import {
  estimateCostUsd,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";

export const briefSchema = z.object({
  title: z.string().min(1),
  outline: z.array(z.string()).min(1),
  draftContent: z.string().min(10),
  seoKeywords: z.array(z.string()).optional().default([]),
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
  const model = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystemPrompt(input);
  const user = buildUserPrompt(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: briefSchema }),
      system,
      prompt: user,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.anthropic ?? {}) as {
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    };
    const cacheRead = meta.cacheReadInputTokens ?? 0;
    const cacheWrite = meta.cacheCreationInputTokens ?? 0;
    const cost = estimateCostUsd(model, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      model,
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
