import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import { countWords, withinTolerance, deviation } from "@/lib/blog/word-count";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

// Phase A expansion loop knobs.
const WORD_COUNT_TOLERANCE = 0.1; // ±10% of target
const MAX_EXPANSION_PASSES = 2;

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

export interface GenerationPassMeta {
  pass: number;
  kind: "generate" | "expand";
  word_count: number;
  cost_usd: number;
  duration_ms: number;
}

export interface GenerationMeta {
  passes: GenerationPassMeta[];
  target_word_count: number;
  final_word_count: number;
  stopped_reason:
    | "ok"
    | "within_tolerance_initial"
    | "expanded_to_tolerance"
    | "max_passes_reached"
    | "error";
  total_cost_usd: number;
}

export interface GenerateBlogResult {
  post: GeneratedBlogPost;
  meta: GenerationMeta;
}

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

function buildVoiceBlock(voice: BrandVoice | null): string {
  if (!voice) {
    return "No brand voice configured — keep it plainspoken and specific. Avoid generic SEO filler.";
  }
  return [
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

/**
 * Initial generation pass. Word-count target is stated THREE times — in
 * the rules list, in the user prompt header, and as a final reminder —
 * to fight the bug where GPT-4.1 delivered ~60% of requested length.
 */
async function initialGenerate(
  input: GenerateBlogInput,
  targetWordCount: number,
  voiceBlock: string
): Promise<{ post: GeneratedBlogPost; cost: number; durationMs: number }> {
  const started = Date.now();

  const system = [
    `You write SEO-optimized blog posts for ${input.tenantName}.`,
    voiceBlock,
    "",
    "Rules:",
    `- **Target word count: ${targetWordCount} words (±10%).** Do NOT deliver significantly fewer words — short drafts are rejected.`,
    "- Write in markdown. Use ## for section headings, ### for subheadings.",
    "- Include the target keyword naturally in title, meta description, first paragraph, one H2, and conclusion. Never keyword-stuff.",
    "- meta_description is 140-160 characters, action-oriented.",
    "- outline is an array of { heading, bullets } objects covering the section structure.",
    "- content is the full markdown article, starting with the H1 title.",
    "- secondary_keywords is 3-6 naturally related phrases the article should rank for.",
    "- Return ONLY JSON matching the schema.",
    `- **Final reminder: the finished \`content\` field must be approximately ${targetWordCount} words. Count your output before returning. If it's under, add genuine depth (examples, specifics, edge cases) until it hits the target.**`,
  ].join("\n");

  const user = [
    `Target keyword: ${input.targetKeyword}`,
    `**Word count: ${targetWordCount} (±10%). Count before returning.**`,
    input.extraContext ? `Context/angle: ${input.extraContext}` : "",
    "",
    "Draft the blog post.",
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

    return { post: result.output, cost, durationMs: Date.now() - started };
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

/**
 * Expansion pass. Rewrites the `content` field only — title, meta, and
 * outline carry over from the previous pass. Uses the versioned
 * prompts/blog/expand.md template so the expansion rules live in one
 * place editors can tune.
 */
async function expandContent(args: {
  input: GenerateBlogInput;
  current: GeneratedBlogPost;
  currentWordCount: number;
  targetWordCount: number;
  voiceBlock: string;
}): Promise<{ post: GeneratedBlogPost; cost: number; durationMs: number }> {
  const started = Date.now();
  const { input, current, currentWordCount, targetWordCount, voiceBlock } = args;

  const prompt = loadPrompt("blog/expand");
  const userText = renderTemplate(prompt.userTemplate, {
    current_word_count: currentWordCount,
    target_word_count: targetWordCount,
    shortfall: Math.max(0, targetWordCount - currentWordCount),
    voice_block: voiceBlock,
    // Phase A has no positioning block yet — send empty so the template
    // render stays stable. Phase B will wire brand_positioning.
    positioning_block: "",
    current_content: current.content,
  });

  // Only re-emit `content`. Other fields remain unchanged.
  const contentOnlySchema = z.object({ content: z.string().min(100) });

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: contentOnlySchema }),
      system: prompt.system,
      prompt: userText,
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

    return {
      post: { ...current, content: result.output.content },
      cost,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogGenerationError("Failed to expand blog post", err);
  }
}

/**
 * Generate a blog post, then expand if the delivered word count is
 * under the target by more than 10%. Up to 2 expansion passes. Each
 * pass records its cost + duration in `meta.passes` so we can post-
 * mortem the ~720/1200 bug in production.
 *
 * Returns BOTH the final post AND the generation meta — callers persist
 * meta to `blog_posts.generation_meta` for debugging.
 */
export async function generateBlogPost(
  input: GenerateBlogInput
): Promise<GenerateBlogResult> {
  const targetWordCount = input.targetWordCount ?? 1200;
  const voiceBlock = buildVoiceBlock(input.voice);

  const passes: GenerationPassMeta[] = [];
  let totalCost = 0;

  // Pass 1: initial generation.
  const first = await initialGenerate(input, targetWordCount, voiceBlock);
  const firstWordCount = countWords(first.post.content);
  passes.push({
    pass: 1,
    kind: "generate",
    word_count: firstWordCount,
    cost_usd: first.cost,
    duration_ms: first.durationMs,
  });
  totalCost += first.cost;

  let currentPost = first.post;
  let currentWordCount = firstWordCount;
  let stoppedReason: GenerationMeta["stopped_reason"] =
    "within_tolerance_initial";

  // Only expand if we're SHORT by more than tolerance. Over-target is
  // fine — we never ask the model to trim.
  if (
    !withinTolerance(currentWordCount, targetWordCount, WORD_COUNT_TOLERANCE) &&
    deviation(currentWordCount, targetWordCount) < 0
  ) {
    for (
      let expansion = 1;
      expansion <= MAX_EXPANSION_PASSES;
      expansion++
    ) {
      const ex = await expandContent({
        input,
        current: currentPost,
        currentWordCount,
        targetWordCount,
        voiceBlock,
      });
      const exWordCount = countWords(ex.post.content);
      passes.push({
        pass: passes.length + 1,
        kind: "expand",
        word_count: exWordCount,
        cost_usd: ex.cost,
        duration_ms: ex.durationMs,
      });
      totalCost += ex.cost;
      currentPost = ex.post;
      currentWordCount = exWordCount;

      if (
        withinTolerance(currentWordCount, targetWordCount, WORD_COUNT_TOLERANCE) ||
        deviation(currentWordCount, targetWordCount) >= 0
      ) {
        stoppedReason = "expanded_to_tolerance";
        break;
      }

      if (expansion === MAX_EXPANSION_PASSES) {
        stoppedReason = "max_passes_reached";
      }
    }
  }

  return {
    post: currentPost,
    meta: {
      passes,
      target_word_count: targetWordCount,
      final_word_count: currentWordCount,
      stopped_reason: stoppedReason,
      total_cost_usd: Number(totalCost.toFixed(4)),
    },
  };
}
