// Combined AI scorer. Rates the three AI-driven dimensions
// (Alignment, Depth-AI, E-E-A-T-AI) in ONE request via
// prompts/scoring/combined.md, returning all three as structured
// output. Replaces the previous three separate calls to cut ~65% of
// scoring cost (post content is embedded once instead of three times)
// and uses gpt-4o-mini for another ~13x cut on raw per-token price.

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall, getModelId } from "@/lib/ai/gateway";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { ScoreIssue } from "./types";

const MODEL = "gpt-4o-mini";
const MODEL_ID = getModelId("scoring"); // "openai/gpt-4o-mini"

const combinedSchema = z.object({
  alignment: z.object({
    topic_fit: z.number().int().min(0).max(5),
    differentiator_presence: z.number().int().min(0).max(5),
    voice_match: z.number().int().min(0).max(5),
    banned_topics_check: z.number().int().min(0).max(5),
    notes: z.object({
      topic_fit: z.string(),
      differentiator_presence: z.string(),
      voice_match: z.string(),
      banned_topics_check: z.string(),
    }),
  }),
  depth: z.object({
    originality_vs_serp: z.number().int().min(0).max(6),
    leverage_of_positioning: z.number().int().min(0).max(3),
    notes: z.object({
      originality_vs_serp: z.string(),
      leverage_of_positioning: z.string(),
    }),
  }),
  eeat: z.object({
    specificity: z.number().int().min(0).max(2),
    appropriate_hedging: z.number().int().min(0).max(2),
    notes: z.object({
      specificity: z.string(),
      appropriate_hedging: z.string(),
    }),
  }),
});

export type CombinedAiOutput = z.infer<typeof combinedSchema>;

export interface CombinedAiInputs {
  tenantSlug: string;
  title: string;
  content: string;
  targetKeyword: string | null;
  positioning: BrandPositioning | null;
  voice: BrandVoice | null;
  serpContext?: Array<{ title: string; url: string; snippet: string }>;
}

export interface CombinedAiResult {
  /** AI output, OR null if the call failed (orchestrator uses neutral fallbacks). */
  output: CombinedAiOutput | null;
  /** Low-severity issue when the AI call failed, for surfacing in UI. */
  failureIssues: ScoreIssue[];
  costUsd: number;
}

function buildVoiceBlockForScoring(voice: BrandVoice | null): string {
  if (!voice) return "Not configured — rate voice_match = 3 (no-op).";
  return [
    `Tone: ${voice.tone}`,
    `Audience: ${voice.audience}`,
    `Do: ${voice.do_list.join(" | ")}`,
    `Don't: ${voice.dont_list.join(" | ")}`,
    voice.example_posts.length > 0
      ? `Example posts: ${voice.example_posts.map((p, i) => `(${i + 1}) ${p}`).join(" ··· ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runCombinedAiScore(
  inp: CombinedAiInputs
): Promise<CombinedAiResult> {
  const started = Date.now();

  const prompt = loadPrompt("scoring/combined");
  const serpContextText =
    inp.serpContext && inp.serpContext.length > 0
      ? inp.serpContext
          .slice(0, 10)
          .map(
            (r, i) =>
              `${i + 1}. ${r.title} (${r.url})\n   ${(r.snippet ?? "").slice(0, 200)}`
          )
          .join("\n")
      : "(no SERP context available — rate originality against your general knowledge)";

  const user = renderTemplate(prompt.userTemplate, {
    positioning_block: buildPositioningBlock(inp.positioning),
    voice_block: buildVoiceBlockForScoring(inp.voice),
    target_keyword: inp.targetKeyword ?? "(none)",
    serp_context: serpContextText,
    post_title: inp.title,
    post_content: inp.content,
  });

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: combinedSchema }),
      system: prompt.system,
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
      tenantSlug: inp.tenantSlug,
      purpose: "scoring",
      feature: "blog_score_combined",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return { output: result.output, failureIssues: [], costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: inp.tenantSlug,
      purpose: "scoring",
      feature: "blog_score_combined",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    return {
      output: null,
      costUsd: 0,
      failureIssues: [
        {
          subScore: "alignment",
          severity: "low",
          message:
            "AI scorer failed — used neutral fallback for alignment/depth/E-E-A-T.",
          suggestedFix: "Click Rescore on the blog row to re-run.",
        },
      ],
    };
  }
}
