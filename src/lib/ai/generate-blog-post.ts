import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";
import { countWords, withinTolerance, deviation } from "@/lib/blog/word-count";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";
import { scoreBlogPost, type ScoreBlogResult } from "@/lib/ai/score-blog";
import type { ScoreIssue } from "@/lib/ai/score-subscores/types";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

// Word-count loop (Phase A).
const WORD_COUNT_TOLERANCE = 0.1; // ±10% of target
const MAX_EXPANSION_PASSES = 2;

// Score loop (Phase B). Target bumped 80 → 90 after user feedback:
// anything below 90 feels like a draft, not a ship. The regenerate
// CTA on the side panel is the escape hatch when iterate exhausts.
const SCORE_TARGET = 90;
const MAX_REFINE_PASSES = 3;
// Total per-post cost ceiling. Scoring is cheap since the combined-ai
// refactor (gpt-4o-mini, one call instead of three), so the cap stays
// at $0.10. Typical successful blog at target 90: ~$0.03–0.06.
// Worst case with full refine budget: ~$0.08.
const COST_CAP_USD = 0.1;

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
  kind: "generate" | "expand" | "refine";
  word_count: number;
  score?: number;
  issues_fixed?: string[];
  cost_usd: number;
  duration_ms: number;
}

export interface GenerationMeta {
  passes: GenerationPassMeta[];
  target_word_count: number;
  final_word_count: number;
  final_score?: number;
  score_warning?: boolean;
  stopped_reason:
    | "ok"
    | "within_tolerance_initial"
    | "expanded_to_tolerance"
    | "max_passes_reached"
    | "score_target_hit"
    | "score_ceiling_hit"
    | "cost_cap"
    | "error";
  total_cost_usd: number;
}

export interface GenerateBlogResult {
  post: GeneratedBlogPost;
  meta: GenerationMeta;
  /** Present when Phase B scoring ran. null when scoring was skipped. */
  score: ScoreBlogResult | null;
}

export class BlogGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "BlogGenerationError";
  }
}

export interface GenerateBlogInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  /** Phase B: Brand Positioning layers with voice on every generation. */
  positioning: BrandPositioning | null;
  /**
   * Target keyword. Required for the keyword/SEO path. For a free-form
   * manual create, callers can pass the title as the keyword OR leave
   * this empty-string — the prompt degrades gracefully.
   */
  targetKeyword: string;
  /**
   * Optional user-supplied title. Phase C manual-create flow. When
   * empty the AI generates one from scratch. When set:
   *   improveTitle=false → AI must use the title verbatim
   *   improveTitle=true  → AI may polish for SEO but keep intent
   */
  titleOverride?: string;
  improveTitle?: boolean;
  extraContext?: string;
  targetWordCount?: number;
  /** Set false to skip the score+refine loop (e.g. dev/debug). Default true. */
  runScoring?: boolean;
}

export function buildVoiceBlock(voice: BrandVoice | null): string {
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
export async function initialGenerate(
  input: GenerateBlogInput,
  targetWordCount: number,
  voiceBlock: string,
  positioningBlock: string
): Promise<{ post: GeneratedBlogPost; cost: number; durationMs: number }> {
  const started = Date.now();

  // Title rules vary by manual-create mode:
  //   no override          → AI generates the title
  //   override + no polish → use verbatim
  //   override + polish    → may refine for SEO but keep intent
  const titleRule = !input.titleOverride
    ? "- Generate a compelling title that includes the target keyword naturally."
    : input.improveTitle
      ? `- Starting title: "${input.titleOverride}". You MAY refine it for clarity/SEO but keep the original intent. Do not change meaning — only polish.`
      : `- Title is FIXED: "${input.titleOverride}". Use this exact string. Do NOT modify it even to improve SEO.`;

  const system = [
    `You write SEO-optimized blog posts for ${input.tenantName}.`,
    voiceBlock,
    "",
    positioningBlock,
    "",
    "Rules:",
    `- **Target word count: ${targetWordCount} words (±10%).** Do NOT deliver significantly fewer words — short drafts are rejected.`,
    titleRule,
    "- **Heading discipline (strict):** exactly ONE `#` heading, used for the title on the first line. Every section heading is `##`. Every sub-section is `###`. NEVER use `#` for a section heading — that breaks downstream scoring.",
    "- Include the target keyword naturally in the title (subject to title rule above), meta description, first paragraph, one H2, and conclusion. Never keyword-stuff.",
    "- meta_description is 140-160 characters, action-oriented.",
    "- outline is an array of { heading, bullets } objects covering the section structure.",
    "- content is the full markdown article, starting with the single `#` title on line 1.",
    "- secondary_keywords is 3-6 naturally related phrases the article should rank for.",
    "- This schema has no separate FAQ field. Do NOT write a 'Frequently Asked Questions' section, a Q&A block, or any structured/schema data (JSON, JSON-LD, a fenced code block) into `content` — readers should never see raw data formatting in the article. If the topic calls for FAQ-style content, weave the answers into normal prose paragraphs instead.",
    "- Return ONLY JSON matching the schema.",
    `- **Final reminder: the finished \`content\` field must be approximately ${targetWordCount} words. Count your output before returning. If it's under, add genuine depth (examples, specifics, edge cases) until it hits the target.**`,
  ].join("\n");

  const user = [
    input.targetKeyword ? `Target keyword: ${input.targetKeyword}` : null,
    `**Word count: ${targetWordCount} (±10%). Count before returning.**`,
    input.extraContext ? `Context/angle: ${input.extraContext}` : null,
    "",
    "Draft the blog post.",
  ]
    .filter((s): s is string => s !== null)
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
      feature: "blog_generate",
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
      feature: "blog_generate",
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
export async function expandContent(args: {
  input: GenerateBlogInput;
  current: GeneratedBlogPost;
  currentWordCount: number;
  targetWordCount: number;
  voiceBlock: string;
  positioningBlock: string;
}): Promise<{ post: GeneratedBlogPost; cost: number; durationMs: number }> {
  const started = Date.now();
  const {
    input,
    current,
    currentWordCount,
    targetWordCount,
    voiceBlock,
    positioningBlock,
  } = args;

  const prompt = loadPrompt("blog/expand");
  const userText = renderTemplate(prompt.userTemplate, {
    current_word_count: currentWordCount,
    target_word_count: targetWordCount,
    shortfall: Math.max(0, targetWordCount - currentWordCount),
    voice_block: voiceBlock,
    positioning_block: positioningBlock,
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
      feature: "blog_expand",
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
      feature: "blog_expand",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogGenerationError("Failed to expand blog post", err);
  }
}

/**
 * Refine pass — targeted fixes based on the prior pass's score issues.
 * Same content-only schema as expand; preserves title/meta/outline.
 */
export async function refineContent(args: {
  input: GenerateBlogInput;
  current: GeneratedBlogPost;
  currentScore: number;
  issues: ScoreIssue[];
  voiceBlock: string;
  positioningBlock: string;
}): Promise<{ post: GeneratedBlogPost; cost: number; durationMs: number }> {
  const started = Date.now();
  const { input, current, currentScore, issues, voiceBlock, positioningBlock } =
    args;

  // Only feed high + med severity issues into the refine prompt — low
  // severity is noise that would distract from the bigger problems.
  const actionable = issues.filter(
    (i) => i.severity === "high" || i.severity === "med"
  );

  const issuesBlock = actionable.length
    ? actionable
        .map(
          (i, idx) =>
            `${idx + 1}. [${i.severity.toUpperCase()} · ${i.subScore}] ${i.message}\n   → Fix: ${i.suggestedFix}`
        )
        .join("\n\n")
    : "(No high/med-severity issues — polish anything that feels weak.)";

  const prompt = loadPrompt("blog/refine");
  const userText = renderTemplate(prompt.userTemplate, {
    current_score: currentScore,
    issues_block: issuesBlock,
    voice_block: voiceBlock,
    positioning_block: positioningBlock,
    current_content: current.content,
  });

  const contentOnlySchema = z.object({ content: z.string().min(100) });

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: contentOnlySchema }),
      system: prompt.system,
      prompt: userText,
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
      feature: "blog_refine",
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
      feature: "blog_refine",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogGenerationError("Failed to refine blog post", err);
  }
}

/**
 * End-to-end blog generation:
 *   1. Initial pass
 *   2. Expansion loop — up to 2 passes if word count < target by >10%
 *   3. Score pass — all 7 sub-scores
 *   4. If score < 80, refine loop — up to 3 passes, each feeding the
 *      previous pass's high/med issues into a targeted fix prompt.
 *   5. Cost cap at $0.25/post early-exits with warning.
 *
 * Full pass-by-pass trail in `meta.passes` so we can post-mortem any
 * generation. Score column persists to `blog_posts.content_score`.
 */
export async function generateBlogPost(
  input: GenerateBlogInput
): Promise<GenerateBlogResult> {
  const targetWordCount = input.targetWordCount ?? 1200;
  const voiceBlock = buildVoiceBlock(input.voice);
  const positioningBlock = buildPositioningBlock(input.positioning);
  const runScoring = input.runScoring ?? true;

  const passes: GenerationPassMeta[] = [];
  let totalCost = 0;

  // Pass 1: initial generation.
  const first = await initialGenerate(
    input,
    targetWordCount,
    voiceBlock,
    positioningBlock
  );
  let currentPost = first.post;
  let currentWordCount = countWords(currentPost.content);
  passes.push({
    pass: 1,
    kind: "generate",
    word_count: currentWordCount,
    cost_usd: first.cost,
    duration_ms: first.durationMs,
  });
  totalCost += first.cost;
  let stoppedReason: GenerationMeta["stopped_reason"] =
    "within_tolerance_initial";

  // Word-count expansion loop (Phase A).
  if (
    !withinTolerance(currentWordCount, targetWordCount, WORD_COUNT_TOLERANCE) &&
    deviation(currentWordCount, targetWordCount) < 0
  ) {
    for (let ex = 1; ex <= MAX_EXPANSION_PASSES; ex++) {
      const r = await expandContent({
        input,
        current: currentPost,
        currentWordCount,
        targetWordCount,
        voiceBlock,
        positioningBlock,
      });
      currentPost = r.post;
      currentWordCount = countWords(currentPost.content);
      passes.push({
        pass: passes.length + 1,
        kind: "expand",
        word_count: currentWordCount,
        cost_usd: r.cost,
        duration_ms: r.durationMs,
      });
      totalCost += r.cost;

      if (
        withinTolerance(currentWordCount, targetWordCount, WORD_COUNT_TOLERANCE) ||
        deviation(currentWordCount, targetWordCount) >= 0
      ) {
        stoppedReason = "expanded_to_tolerance";
        break;
      }
      if (ex === MAX_EXPANSION_PASSES) stoppedReason = "max_passes_reached";
    }
  }

  // Short-circuit: skip scoring when caller asked (debug) or cost cap hit.
  if (!runScoring) {
    return buildResult({
      post: currentPost,
      passes,
      targetWordCount,
      finalWordCount: currentWordCount,
      totalCost,
      stoppedReason,
      score: null,
    });
  }
  if (totalCost >= COST_CAP_USD) {
    return buildResult({
      post: currentPost,
      passes,
      targetWordCount,
      finalWordCount: currentWordCount,
      totalCost,
      stoppedReason: "cost_cap",
      score: null,
    });
  }

  // Score pass.
  let score = await scoreBlogPost({
    tenantSlug: input.tenantSlug,
    post: {
      title: currentPost.title,
      metaDescription: currentPost.meta_description,
      content: currentPost.content,
      outline: currentPost.outline,
      targetKeyword: input.targetKeyword,
      secondaryKeywords: currentPost.secondary_keywords,
      targetWordCount,
    },
    positioning: input.positioning,
    voice: input.voice,
  });
  totalCost += score.aiCostUsd;

  if (score.total >= SCORE_TARGET) {
    return buildResult({
      post: currentPost,
      passes,
      targetWordCount,
      finalWordCount: currentWordCount,
      totalCost,
      stoppedReason: "score_target_hit",
      score,
    });
  }

  // Refine loop — up to 3 passes. Each pass feeds back the previous
  // pass's high/med issues.
  for (let pass = 1; pass <= MAX_REFINE_PASSES; pass++) {
    if (totalCost >= COST_CAP_USD) {
      return buildResult({
        post: currentPost,
        passes,
        targetWordCount,
        finalWordCount: currentWordCount,
        totalCost,
        stoppedReason: "cost_cap",
        score,
      });
    }

    const prevScore = score.total;
    const r = await refineContent({
      input,
      current: currentPost,
      currentScore: prevScore,
      issues: score.issues,
      voiceBlock,
      positioningBlock,
    });
    currentPost = r.post;
    currentWordCount = countWords(currentPost.content);
    totalCost += r.cost;

    score = await scoreBlogPost({
      tenantSlug: input.tenantSlug,
      post: {
        title: currentPost.title,
        metaDescription: currentPost.meta_description,
        content: currentPost.content,
        outline: currentPost.outline,
        targetKeyword: input.targetKeyword,
        secondaryKeywords: currentPost.secondary_keywords,
        targetWordCount,
      },
      positioning: input.positioning,
      voice: input.voice,
    });
    totalCost += score.aiCostUsd;

    passes.push({
      pass: passes.length + 1,
      kind: "refine",
      word_count: currentWordCount,
      score: score.total,
      cost_usd: r.cost + score.aiCostUsd,
      duration_ms: r.durationMs,
    });

    if (score.total >= SCORE_TARGET) {
      return buildResult({
        post: currentPost,
        passes,
        targetWordCount,
        finalWordCount: currentWordCount,
        totalCost,
        stoppedReason: "score_target_hit",
        score,
      });
    }
  }

  // Exhausted refine budget without hitting target — surface as warning.
  return buildResult({
    post: currentPost,
    passes,
    targetWordCount,
    finalWordCount: currentWordCount,
    totalCost,
    stoppedReason: "score_ceiling_hit",
    score,
  });
}

function buildResult(args: {
  post: GeneratedBlogPost;
  passes: GenerationPassMeta[];
  targetWordCount: number;
  finalWordCount: number;
  totalCost: number;
  stoppedReason: GenerationMeta["stopped_reason"];
  score: ScoreBlogResult | null;
}): GenerateBlogResult {
  const warningReasons: GenerationMeta["stopped_reason"][] = [
    "max_passes_reached",
    "score_ceiling_hit",
    "cost_cap",
  ];
  return {
    post: args.post,
    score: args.score,
    meta: {
      passes: args.passes,
      target_word_count: args.targetWordCount,
      final_word_count: args.finalWordCount,
      final_score: args.score?.total,
      score_warning: warningReasons.includes(args.stoppedReason),
      stopped_reason: args.stoppedReason,
      total_cost_usd: Number(args.totalCost.toFixed(4)),
    },
  };
}
