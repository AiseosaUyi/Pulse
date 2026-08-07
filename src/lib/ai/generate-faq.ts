import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import { buildVoiceBlock } from "@/lib/ai/generate-blog-post";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

const faqItemsSchema = z.object({
  items: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      })
    )
    .min(3)
    .max(5),
});

export class FaqGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "FaqGenerationError";
  }
}

/**
 * Generates 3-5 FAQ Q&A pairs grounded on a post's real title + body —
 * these feed blog_posts.faq_items, which the publish path pushes to
 * Contentful's faqItems field and the live site renders as invisible
 * FAQPage JSON-LD (never inline in the article). Never shown to the model
 * as something to write INTO the body — src/lib/seo/strip-inline-faq.ts is
 * the defensive backstop if a generator ever does that anyway.
 */
export async function generateFaqForPost(input: {
  tenantSlug: string;
  title: string;
  content: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  existingQuestions: string[];
}): Promise<{ items: Array<{ question: string; answer: string }>; costUsd: number }> {
  const started = Date.now();
  const voiceBlock = buildVoiceBlock(input.voice);
  const positioningBlock = buildPositioningBlock(input.positioning);

  const system = [
    "You write FAQ question/answer pairs for a blog post's structured data (FAQPage schema). These are NEVER shown inline in the article body — they stand alone, so each pair must make sense without the reader having already read the post.",
    voiceBlock,
    "",
    positioningBlock,
    "",
    `Post title: ${input.title}`,
    "",
    "Rules:",
    "- 3-5 pairs, grounded ONLY in what the post body below actually says (plus the title). Never invent statistics, guarantees, testimonials, or claims not already present in the post.",
    "- Answers are 1-3 sentences, plain language, no em-dashes or en-dashes (use commas, periods, or parentheses).",
    "- Questions should be genuinely useful search-style questions a reader would ask, not restatements of headings.",
    input.existingQuestions.length
      ? `- Do not repeat these already-existing questions: ${input.existingQuestions.join(" | ")}`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const user = [
    "Post body:",
    input.content.slice(0, 8000),
    "",
    "Write the FAQ now.",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: faqItemsSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const providerMeta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = providerMeta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "blog_faq_generate",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return { items: result.output.items, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "blog_faq_generate",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new FaqGenerationError("Failed to generate FAQ", err);
  }
}
