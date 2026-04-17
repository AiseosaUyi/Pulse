import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export const blogPostSchema = z.object({
  title: z.string().min(1),
  meta_description: z.string().min(1),
  outline: z
    .array(
      z.object({
        heading: z.string(),
        bullets: z.array(z.string()),
      })
    )
    .min(1),
  content: z.string().min(100),
  secondary_keywords: z.array(z.string()),
});

export type GeneratedBlogPost = z.infer<typeof blogPostSchema>;

export class BlogGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "BlogGenerationError";
  }
}

interface GenerateBlogInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  targetKeyword: string;
  extraContext?: string;
  targetWordCount?: number;
}

export async function generateBlogPost(
  input: GenerateBlogInput
): Promise<GeneratedBlogPost> {
  const started = Date.now();
  const wordCount = input.targetWordCount ?? 1200;

  const voiceBlock = input.voice
    ? [
        `Brand voice:`,
        `- Tone: ${input.voice.tone}`,
        `- Audience: ${input.voice.audience}`,
        `- Do: ${input.voice.do_list.join(" | ")}`,
        `- Don't: ${input.voice.dont_list.join(" | ")}`,
        "",
        "Examples of our voice:",
        ...input.voice.example_posts.map((p, i) => `  ${i + 1}. ${p}`),
      ].join("\n")
    : "No brand voice configured — keep it plainspoken and specific. Avoid generic SEO filler.";

  const system = [
    `You write SEO-optimized blog posts for ${input.tenantName}.`,
    voiceBlock,
    "",
    "Rules:",
    `- Target ~${wordCount} words. Don't pad. If the topic doesn't warrant that much, say less well.`,
    "- Write in markdown. Use ## for section headings, ### for subheadings.",
    "- Include the target keyword naturally in title, meta description, first paragraph, one H2, and conclusion. Never keyword-stuff.",
    "- meta_description is 140-160 characters, action-oriented.",
    "- outline is an array of { heading, bullets } objects covering the section structure (for editorial review).",
    "- content is the full markdown article, starting with the H1 title.",
    "- secondary_keywords is 3-6 naturally related phrases the article should rank for.",
    "- Return ONLY JSON matching the schema.",
  ].join("\n");

  const user = [
    `Target keyword: ${input.targetKeyword}`,
    input.extraContext ? `Context/angle: ${input.extraContext}` : "",
    "",
    `Draft the blog post.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: blogPostSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = meta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      model: MODEL_ID,
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
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogGenerationError("Failed to generate blog post", err);
  }
}
