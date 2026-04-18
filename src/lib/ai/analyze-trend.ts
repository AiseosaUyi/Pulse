import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { TrendPlatform } from "@/lib/types/trends";

export const trendAnalysisSchema = z.object({
  why_viral: z.string().min(1),
  format: z.string().min(1),
  applicability: z.enum(["high", "medium", "low", "n/a"]),
  suggested_adaptation: z.string().min(1),
});

export type AnalyzedTrend = z.infer<typeof trendAnalysisSchema>;

interface AnalyzeInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  platform: TrendPlatform;
  summary: string;
  hashtag?: string | null;
  metrics?: Record<string, unknown>;
}

export async function analyzeTrend(
  input: AnalyzeInput
): Promise<AnalyzedTrend> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const voiceBlock = input.voice
    ? [
        "Our brand voice:",
        `- Tone: ${input.voice.tone}`,
        `- Audience: ${input.voice.audience}`,
      ].join("\n")
    : "(No brand voice configured — default to broad applicability judgment.)";

  const system = [
    `You analyze viral content trends for ${input.tenantName}.`,
    voiceBlock,
    "",
    "For any trend, return JSON with: why_viral (why this is trending), format (the content format e.g. 'reveal reel', 'POV skit', 'cocktail recipe'), applicability ('high' | 'medium' | 'low' | 'n/a' — can our brand participate authentically?), suggested_adaptation (one concrete idea for our brand, 1-2 sentences).",
  ].join("\n");

  const user = [
    `Platform: ${input.platform}`,
    input.hashtag ? `Hashtag: ${input.hashtag}` : "",
    input.metrics && Object.keys(input.metrics).length > 0
      ? `Metrics: ${JSON.stringify(input.metrics)}`
      : "",
    `Summary: ${input.summary}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: trendAnalysisSchema }),
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
      feature: "trend_analyze",
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
      feature: "trend_analyze",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
