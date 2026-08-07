// Per-section generation for the manual blog-authoring flow (section
// builder). Unlike generateBlogPost() in generate-blog-post.ts, which
// always writes the whole article in one pass, these functions write
// exactly one section (or the FAQ list) at a time, using the title plus
// whatever sibling sections the author has already drafted as context —
// so a manually-typed intro shapes an AI-generated body section, etc.

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, getModelId, estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";
import { buildVoiceBlock } from "@/lib/ai/generate-blog-post";
import { BLOG_TYPE_LABELS, type BlogType } from "@/lib/types/blog-ideation";
import type { DraftSection } from "@/lib/types/blog-posts";

export class BlogSectionGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "BlogSectionGenerationError";
  }
}

interface SharedContext {
  tenantSlug: string;
  title: string;
  blogType?: BlogType | null;
  extraContext?: string | null;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
}

function describeSiblings(sections: DraftSection[]): string {
  const written = sections.filter((s) => s.content.trim().length > 0);
  if (written.length === 0) return "(No other sections written yet.)";
  return written
    .map((s) => `[${s.kind}${s.heading ? ` — ${s.heading}` : ""}]\n${s.content}`)
    .join("\n\n");
}

function contextHeader(input: SharedContext): string {
  return [
    `Post title: ${input.title}`,
    input.blogType ? `Post type: ${BLOG_TYPE_LABELS[input.blogType]}` : null,
    input.extraContext ? `Extra context: ${input.extraContext}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");
}

const sectionSchema = z.object({ content: z.string().min(1) });

export interface GenerateBlogSectionInput extends SharedContext {
  kind: DraftSection["kind"];
  heading: string;
  siblingSections: DraftSection[];
}

/** Generates the prose for exactly one section (intro/body/conclusion). */
export async function generateBlogSection(
  input: GenerateBlogSectionInput
): Promise<{ content: string; costUsd: number }> {
  const started = Date.now();
  const modelId = getModelId("synthesis");
  const voiceBlock = buildVoiceBlock(input.voice);
  const positioningBlock = buildPositioningBlock(input.positioning);

  const kindInstructions: Record<DraftSection["kind"], string> = {
    intro:
      "Write the opening paragraph(s) — hook the reader and set up what they'll get. No heading.",
    body: `Write one self-contained body section under the heading "${
      input.heading || "(untitled section)"
    }", 150-350 words. Don't repeat the heading text in the prose.`,
    conclusion:
      "Write the closing paragraph(s) — wrap up with a clear takeaway. No heading, no generic 'in conclusion' filler.",
  };

  const system = [
    "You write one section at a time of a blog post, working from a title and whatever sibling sections the author has already drafted.",
    voiceBlock,
    "",
    positioningBlock,
    "",
    contextHeader(input),
    "",
    "Rules:",
    `- ${kindInstructions[input.kind]}`,
    "- Match the tone and any claims already established in the sibling sections below — don't contradict or repeat them.",
    "- Never invent statistics, guarantees, testimonials, or competitor prices not already given in context.",
    "- No em-dashes or en-dashes anywhere — use commas, periods, or parentheses.",
    "- Return ONLY the section's prose in `content`.",
  ].join("\n");

  const user = [
    "Sibling sections already drafted:",
    describeSiblings(input.siblingSections),
    "",
    "Write this section now.",
  ].join("\n");

  try {
    const result = await generateText({
      model: getModel("synthesis"),
      output: Output.object({ schema: sectionSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const providerMeta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = providerMeta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "blog_section_generate",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return { content: result.output.content, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "blog_section_generate",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogSectionGenerationError("Failed to generate section", err);
  }
}

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

export interface GenerateFaqItemsInput extends SharedContext {
  siblingSections: DraftSection[];
  existingQuestions: string[];
}

/** Generates 3-5 FAQ Q&A pairs from the title + sections drafted so far. */
export async function generateFaqItems(
  input: GenerateFaqItemsInput
): Promise<{ items: Array<{ question: string; answer: string }>; costUsd: number }> {
  const started = Date.now();
  const modelId = getModelId("synthesis");
  const voiceBlock = buildVoiceBlock(input.voice);
  const positioningBlock = buildPositioningBlock(input.positioning);

  const system = [
    "You write FAQ question/answer pairs for a blog post's structured data (FAQPage schema) — these are never shown inline in the article body, so each pair must stand alone without assuming the reader already read the post.",
    voiceBlock,
    "",
    positioningBlock,
    "",
    contextHeader(input),
    "",
    "Rules:",
    "- 3-5 pairs, grounded only in what the sections below actually say plus the title/context above.",
    "- Never invent statistics, guarantees, testimonials, or competitor prices not already given in context.",
    "- Answers are 1-3 sentences, plain language, no em/en dashes.",
    input.existingQuestions.length
      ? `- Do not repeat these already-existing questions: ${input.existingQuestions.join(" | ")}`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const user = [
    "Sections written so far:",
    describeSiblings(input.siblingSections),
    "",
    "Write the FAQ now.",
  ].join("\n");

  try {
    const result = await generateText({
      model: getModel("synthesis"),
      output: Output.object({ schema: faqItemsSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const providerMeta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = providerMeta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "blog_faq_generate",
      model: modelId,
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
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogSectionGenerationError("Failed to generate FAQ", err);
  }
}
