import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { OwnMetricsPlatform, OwnMetricsPayload } from "@/lib/types/own-metrics";

export const extractedMetricsSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "twitter", "linkedin"]),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  saves: z.number().nullable(),
  reach: z.number().nullable(),
  impressions: z.number().nullable(),
  engagement_rate: z.number().nullable(),
  caption: z.string().nullable(),
  posted_at: z.string().nullable(),
});

export type ExtractedMetrics = z.infer<typeof extractedMetricsSchema>;

export interface ExtractionResult {
  platform: OwnMetricsPlatform;
  metrics: OwnMetricsPayload;
  caption: string | null;
  postedAt: string | null;
}

interface ExtractInput {
  tenantSlug: string;
  imageBase64: string;          // base64 with data: prefix
  hintPlatform?: OwnMetricsPlatform;
}

// gpt-4o is noticeably better at OCR than gpt-4.1 for screenshots.
const MODEL = "gpt-4o";
const MODEL_ID = `openai/${MODEL}`;

export async function extractMetricsFromScreenshot(
  input: ExtractInput
): Promise<ExtractionResult> {
  const started = Date.now();
  const hint = input.hintPlatform
    ? `The user says this is an ${input.hintPlatform} screenshot.`
    : "Infer the platform from visual cues (logo, layout, fonts).";

  const system = [
    "You extract social-media post performance metrics from a screenshot.",
    hint,
    "Return a JSON object matching the schema. For any number you cannot see clearly, return null.",
    "Don't invent numbers. Don't guess. If a field isn't visible, null is the right answer.",
    "engagement_rate should be a decimal percentage (e.g. 12.5 for 12.5%), not a fraction.",
    "posted_at should be an ISO date if a clear date is visible, else null.",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: extractedMetricsSchema }),
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the metrics from this screenshot." },
            { type: "image", image: input.imageBase64 },
          ],
        },
      ],
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "vision",
      feature: "metrics_extract",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    const o = result.output;
    const metrics: OwnMetricsPayload = {};
    if (o.views !== null) metrics.views = o.views;
    if (o.likes !== null) metrics.likes = o.likes;
    if (o.comments !== null) metrics.comments = o.comments;
    if (o.shares !== null) metrics.shares = o.shares;
    if (o.saves !== null) metrics.saves = o.saves;
    if (o.reach !== null) metrics.reach = o.reach;
    if (o.impressions !== null) metrics.impressions = o.impressions;
    if (o.engagement_rate !== null) metrics.engagement_rate = o.engagement_rate;

    return {
      platform: o.platform,
      metrics,
      caption: o.caption,
      postedAt: o.posted_at,
    };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "vision",
      feature: "metrics_extract",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
