// Brand Alignment AI half — 20 pts total (pre-check cap: -5 if any
// banned topic appears).

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";
import { buildPositioningBlock, type BrandPositioning } from "@/lib/ai/brand-positioning";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { ScoreIssue, SubScoreResult } from "./types";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

const alignmentSchema = z.object({
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
});

function includesAnyCI(haystack: string, needles: string[]): string | null {
  const low = haystack.toLowerCase();
  for (const n of needles) {
    if (n.trim().length === 0) continue;
    if (low.includes(n.toLowerCase())) return n;
  }
  return null;
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

export interface AlignmentInputs {
  tenantSlug: string;
  title: string;
  content: string;
  positioning: BrandPositioning | null;
  voice: BrandVoice | null;
}

export async function scoreAlignment(inp: AlignmentInputs): Promise<SubScoreResult> {
  const issues: ScoreIssue[] = [];
  const started = Date.now();

  // 1. Deterministic pre-check — cap -5 if any banned topic is mentioned.
  const bannedHit =
    inp.positioning && inp.positioning.topics_to_avoid.length > 0
      ? includesAnyCI(
          `${inp.title}\n${inp.content}`,
          inp.positioning.topics_to_avoid
        )
      : null;

  // 2. AI rating.
  let topicFit = 0;
  let diff = 0;
  let voiceM = 0;
  let bannedScore = 5;
  let aiNotes: Record<string, string> = {};

  try {
    const prompt = loadPrompt("scoring/brand-alignment");
    const user = renderTemplate(prompt.userTemplate, {
      positioning_block: buildPositioningBlock(inp.positioning),
      voice_block: buildVoiceBlockForScoring(inp.voice),
      post_title: inp.title,
      post_content: inp.content,
    });
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: alignmentSchema }),
      system: prompt.system,
      prompt: user,
    });

    const o = result.output;
    topicFit = o.topic_fit;
    diff = o.differentiator_presence;
    voiceM = o.voice_match;
    bannedScore = o.banned_topics_check;
    aiNotes = o.notes;

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
      feature: "blog_score_alignment",
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
      feature: "blog_score_alignment",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // On failure, assume mid-scores so we don't accidentally flunk the post
    // off a transient AI error. Mark with a low-severity issue.
    topicFit = 3;
    diff = 3;
    voiceM = 3;
    bannedScore = 5;
    issues.push({
      subScore: "alignment",
      severity: "low",
      message: "Brand alignment AI rater failed — used neutral fallback (12/20).",
      suggestedFix: "Rescore the post once to get an accurate alignment read.",
    });
  }

  let score = topicFit + diff + voiceM + bannedScore;

  // Apply deterministic cap for banned-topic matches.
  if (bannedHit) {
    score = Math.max(0, score - 5);
    issues.push({
      subScore: "alignment",
      severity: "high",
      message: `Post mentions a banned topic: "${bannedHit}".`,
      suggestedFix: `Remove references to "${bannedHit}" — it's in your topics_to_avoid list.`,
    });
  }

  // Surface AI notes as low-severity issues when any sub-criterion is weak.
  const flag = (key: "topic_fit" | "differentiator_presence" | "voice_match" | "banned_topics_check", value: number, label: string) => {
    if (value < 4) {
      issues.push({
        subScore: "alignment",
        severity: value < 3 ? "med" : "low",
        message: `${label}: ${value}/5 — ${aiNotes[key] ?? "see AI notes"}`,
        suggestedFix: `Bring ${label.toLowerCase()} up to 4+.`,
      });
    }
  };
  flag("topic_fit", topicFit, "Topic fit");
  flag("differentiator_presence", diff, "Differentiator presence");
  flag("voice_match", voiceM, "Voice match");

  return { score, max: 20, issues };
}
