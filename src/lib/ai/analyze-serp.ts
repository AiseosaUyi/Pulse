import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { SerpResult } from "@/lib/scrape/google-serp";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export const serpAnalysisSchema = z.object({
  common_themes: z.array(z.string()).min(1),
  content_length_hint: z.string().min(1),
  serp_features: z.array(z.string()),
  gap_for_us: z.string().min(1),
  how_to_compete: z.string().min(10),
  our_angle: z.string().min(10),
});

export type SerpAnalysis = z.infer<typeof serpAnalysisSchema>;

interface AnalyzeInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  keyword: string;
  region: string;
  results: SerpResult[];
}

export async function analyzeSerp(
  input: AnalyzeInput
): Promise<{ analysis: SerpAnalysis; costUsd: number }> {
  if (input.results.length === 0) {
    throw new Error("No SERP results to analyze");
  }
  const started = Date.now();

  const voiceBlock = input.voice
    ? [
        "Our brand voice:",
        `- Tone: ${input.voice.tone}`,
        `- Audience: ${input.voice.audience}`,
      ].join("\n")
    : "No brand voice configured — default to plainspoken judgment.";

  const system = [
    `You analyze Google SERP results for ${input.tenantName}.`,
    voiceBlock,
    "",
    "Return JSON with:",
    "- common_themes: 3-6 things the top-ranking pages share (angle, format, depth, examples, tone).",
    "- content_length_hint: e.g. '1500-2000 words, long-form guide' or '800-word listicle'.",
    "- serp_features: zero or more features visible (featured snippet, people also ask, images, video, local pack, etc). Empty array if none apparent.",
    "- gap_for_us: ONE sentence — what no one in the top 10 is doing that we could own.",
    "- how_to_compete: 2-3 sentences — concrete structural advice (headings, examples, depth).",
    "- our_angle: 2-3 sentences — a distinctive angle that fits our brand voice.",
    "Don't invent rankings. Only reason from the titles, snippets, and domains provided.",
  ].join("\n");

  const resultLines = input.results
    .slice(0, 10)
    .map(
      (r) =>
        `${r.position}. ${r.domain} — "${r.title}"\n   ${r.snippet.slice(0, 220)}`
    )
    .join("\n");

  const user = [
    `Keyword: ${input.keyword}`,
    `Region: ${input.region}`,
    "",
    "Top 10 organic results:",
    resultLines,
    "",
    "Analyze.",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: serpAnalysisSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = meta.cachedPromptTokens ?? 0;
    const costUsd = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "serp_analyze",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    return { analysis: result.output, costUsd };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "serp_analyze",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
