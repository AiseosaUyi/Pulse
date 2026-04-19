// Slice 3 — Content Machine. One blog post → 8 distribution artifacts
// in a single structured-output call (cheaper than 8 serial calls and
// keeps voice consistent across formats because the LLM sees all
// formats in context at once).

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";
import {
  DISTRIBUTION_FORMATS,
  type DistributionFormat,
} from "@/lib/types/content-distributions";

export const multipliedSchema = z.object({
  twitter_thread: z
    .string()
    .min(20)
    .describe(
      "5-8 tweets separated by a blank line. First tweet is the hook (no hashtags). Each tweet <=270 chars."
    ),
  linkedin_post: z
    .string()
    .min(50)
    .describe(
      "150-300 word LinkedIn post. Opens with a pattern-break line. Line breaks every 1-2 sentences. Ends with a question."
    ),
  instagram_carousel: z
    .string()
    .min(50)
    .describe(
      "Slide-by-slide script for a 7-slide Instagram carousel. Format: `Slide 1: <text>` on each line. Slide 1 is the hook, final slide is the CTA."
    ),
  tiktok_hook: z
    .string()
    .min(20)
    .describe(
      "3-second spoken TikTok hook plus a 20-30 word continuation bullet list. Pattern-break required."
    ),
  email: z
    .string()
    .min(80)
    .describe(
      "Plain-text email: subject line, preview line, then body <=250 words. Ends with one CTA link placeholder [READ_FULL_POST]."
    ),
  newsletter: z
    .string()
    .min(40)
    .describe(
      "80-150 word newsletter blurb suitable for inclusion in a weekly roundup. One link placeholder [READ_FULL_POST]."
    ),
  reddit_comment: z
    .string()
    .min(60)
    .describe(
      "Authentic Reddit-style comment (no marketing tone) that shares insight from the post. 120-200 words. No links unless asked."
    ),
  youtube_short: z
    .string()
    .min(50)
    .describe(
      "45-second YouTube Short script. Format: `[0:00]` timestamps every 3-5s plus spoken text. End with a subscribe hook."
    ),
});

export type MultipliedContent = z.infer<typeof multipliedSchema>;

export class ContentMultiplyError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ContentMultiplyError";
  }
}

interface MultiplyContentInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  blog: {
    title: string;
    metaDescription: string | null;
    content: string;
    targetKeyword: string | null;
  };
}

export interface MultiplyContentResult {
  artifacts: MultipliedContent;
  model: string;
  costUsd: number;
}

export async function multiplyContent(
  input: MultiplyContentInput
): Promise<MultiplyContentResult> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystemPrompt(input);
  const user = buildUserPrompt(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: multipliedSchema }),
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
      feature: "content_multiply",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return { artifacts: result.output, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "content_multiply",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new ContentMultiplyError("Failed to multiply content", err);
  }
}

function buildSystemPrompt(input: MultiplyContentInput): string {
  const { tenantName, voice, positioning } = input;
  const lines: string[] = [
    `You are the distribution strategist for ${tenantName}. You take a long-form blog post and rewrite it for ${DISTRIBUTION_FORMATS.length} different channels.`,
    "",
    "Ground rules (apply to every format):",
    "- Each artifact must stand alone — readers of the Reddit comment will never click through, so it must deliver value independently.",
    "- Never copy whole paragraphs from the blog. Rewrite for the native voice of each platform.",
    "- Keep the brand's voice consistent across formats; tune cadence, not personality.",
    "- Never invent stats, case studies, or quotes that aren't in the source post.",
    "- Use `[READ_FULL_POST]` wherever a link to the blog is appropriate (email, newsletter only). Don't fabricate URLs.",
  ];

  if (voice) {
    lines.push(
      "",
      "Brand voice:",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`,
      `- Do: ${voice.do_list.join(" | ")}`,
      `- Don't: ${voice.dont_list.join(" | ")}`
    );
  }

  lines.push("", buildPositioningBlock(positioning));

  return lines.join("\n");
}

function buildUserPrompt(input: MultiplyContentInput): string {
  const { blog } = input;
  // Cap the content fed to the model so we stay within reasonable
  // token budgets on long posts. 6000 chars ≈ ~1500 tokens of source,
  // enough to capture positioning + key beats without blowing the
  // output budget when the model re-writes it 8 ways.
  const source = blog.content.slice(0, 6000);
  return [
    "Source blog post to distribute:",
    `Title: ${blog.title}`,
    blog.metaDescription ? `Meta: ${blog.metaDescription}` : "",
    blog.targetKeyword ? `Target keyword: ${blog.targetKeyword}` : "",
    "",
    "Body:",
    source,
    blog.content.length > source.length ? "… [truncated]" : "",
    "",
    `Produce all ${DISTRIBUTION_FORMATS.length} distribution artifacts. Each field in the schema corresponds to one format — fill every one.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function emptyArtifacts(): Record<DistributionFormat, string> {
  return Object.fromEntries(
    DISTRIBUTION_FORMATS.map((f) => [f, ""])
  ) as Record<DistributionFormat, string>;
}
