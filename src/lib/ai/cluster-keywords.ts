import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export const clusteringSchema = z.object({
  clusters: z
    .array(
      z.object({
        name: z.string(),
        keywords: z.array(z.string()),
        intent_summary: z.string(),
        suggested_articles: z.array(z.string()),
      })
    )
    .min(1),
});

export type KeywordClustering = z.infer<typeof clusteringSchema>;

export async function clusterKeywords(input: {
  tenantSlug: string;
  tenantName: string;
  keywords: string[];
}): Promise<KeywordClustering> {
  if (input.keywords.length === 0) {
    return { clusters: [] };
  }
  const started = Date.now();

  const system = [
    `You organize tracked SEO keywords for ${input.tenantName} into topical clusters.`,
    "",
    "Output schema:",
    "- clusters: array of { name, keywords, intent_summary, suggested_articles }",
    "- Each cluster groups keywords that belong together (same topic, same buying stage, same content surface).",
    "- intent_summary: one sentence — what does someone searching these keywords want?",
    "- suggested_articles: 2-4 article titles that would cover the cluster. Titles should be specific, not generic.",
    "- Every input keyword must appear in exactly one cluster.",
    "- Return between 2 and 5 clusters total (fewer is fine if keywords are truly tight).",
  ].join("\n");

  const user = `Keywords to cluster:\n${input.keywords.map((k) => `- ${k}`).join("\n")}`;

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: clusteringSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
