// Depth & Originality — 15 pts. Hybrid: 6 deterministic + 9 AI.
// Rubric v1 §4.

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";
import { countWords, withinTolerance } from "@/lib/blog/word-count";
import type { BrandPositioning } from "@/lib/ai/brand-positioning";
import type { ScoreIssue, SubScoreResult } from "./types";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export interface DepthInputs {
  tenantSlug: string;
  title: string;
  content: string;
  targetKeyword: string | null;
  targetWordCount: number;
  positioning: BrandPositioning | null;
  /** Top SERP results for AI originality comparison. Optional. */
  serpContext?: Array<{ title: string; url: string; snippet: string }>;
}

const depthSchema = z.object({
  originality_vs_serp: z.number().int().min(0).max(6),
  leverage_of_positioning: z.number().int().min(0).max(3),
  notes: z.object({
    originality_vs_serp: z.string(),
    leverage_of_positioning: z.string(),
  }),
});

function specificityDensity(content: string, per500 = 500): number {
  const words = countWords(content);
  if (words === 0) return 0;
  const digits = (content.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
  // Proper noun heuristic: capitalized word not at sentence start.
  const proper = (content.match(/(?<![.!?]\s|^)\b[A-Z][a-z]{2,}\b/g) ?? []).length;
  return ((digits + proper) / words) * per500;
}

export async function scoreDepth(inp: DepthInputs): Promise<SubScoreResult> {
  const issues: ScoreIssue[] = [];
  const actual = countWords(inp.content);

  // Deterministic: word-count band (3 pts)
  let bandScore = 0;
  const offset = Math.abs(actual - inp.targetWordCount) / inp.targetWordCount;
  if (withinTolerance(actual, inp.targetWordCount, 0.1)) bandScore = 3;
  else if (offset <= 0.15) bandScore = 2;
  else if (offset <= 0.25) bandScore = 1;
  if (bandScore < 3) {
    issues.push({
      subScore: "depth",
      severity: bandScore === 0 ? "med" : "low",
      message: `Word count ${actual} vs target ${inp.targetWordCount} — off by ${(offset * 100).toFixed(0)}%.`,
      suggestedFix:
        actual < inp.targetWordCount
          ? "Add depth to undercovered sections (examples, edge cases)."
          : "Trim the filler — not every section needs to be long.",
    });
  }

  // Deterministic: specificity density (3 pts)
  const density = specificityDensity(inp.content);
  let specScore = 0;
  if (density >= 8) specScore = 3;
  else if (density >= 5) specScore = 2;
  else if (density >= 2) specScore = 1;
  if (specScore < 3) {
    issues.push({
      subScore: "depth",
      severity: "low",
      message: `Only ${density.toFixed(1)} specific tokens (numbers, proper nouns) per 500 words.`,
      suggestedFix:
        "Replace abstract phrases with real numbers, brand names, places, or cited studies.",
    });
  }

  // AI: originality vs SERP + leverage of positioning (9 pts)
  const started = Date.now();
  let origScore = 0;
  let levScore = 0;
  let aiNotes: { originality_vs_serp?: string; leverage_of_positioning?: string } =
    {};
  try {
    const prompt = loadPrompt("scoring/depth-originality");
    const serpContextText =
      inp.serpContext && inp.serpContext.length > 0
        ? inp.serpContext
            .slice(0, 10)
            .map(
              (r, i) =>
                `${i + 1}. ${r.title} (${r.url})\n   ${r.snippet?.slice(0, 200)}`
            )
            .join("\n")
        : "(no SERP context available — rate against your general knowledge)";

    const user = renderTemplate(prompt.userTemplate, {
      target_keyword: inp.targetKeyword ?? "(none)",
      value_proposition:
        inp.positioning?.value_proposition ?? "(brand positioning not set)",
      differentiators:
        inp.positioning?.differentiators?.join(" | ") ?? "(none set)",
      serp_context: serpContextText,
      post_title: inp.title,
      post_content: inp.content,
    });
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: depthSchema }),
      system: prompt.system,
      prompt: user,
    });
    origScore = result.output.originality_vs_serp;
    levScore = result.output.leverage_of_positioning;
    aiNotes = result.output.notes;

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
      feature: "blog_score_depth",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
  } catch (err) {
    await logAiCall({
      tenantSlug: inp.tenantSlug,
      purpose: "scoring",
      feature: "blog_score_depth",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Fallback neutral score on AI failure.
    origScore = 4;
    levScore = 2;
    issues.push({
      subScore: "depth",
      severity: "low",
      message: "Depth AI rater failed — used neutral fallback.",
      suggestedFix: "Rescore to get an accurate originality read.",
    });
  }

  if (origScore < 4) {
    issues.push({
      subScore: "depth",
      severity: "med",
      message: `Originality vs SERP: ${origScore}/6 — ${aiNotes.originality_vs_serp ?? "likely a rehash"}`,
      suggestedFix:
        "Take a specific stance the top 10 don't — new data, new framing, or a counter-point.",
    });
  }
  if (levScore < 2) {
    issues.push({
      subScore: "depth",
      severity: "med",
      message: `Brand POV leverage: ${levScore}/3 — ${aiNotes.leverage_of_positioning ?? "could be written by anyone"}`,
      suggestedFix: "Anchor the argument in your value proposition or differentiators.",
    });
  }

  return {
    score: bandScore + specScore + origScore + levScore,
    max: 15,
    issues,
  };
}
