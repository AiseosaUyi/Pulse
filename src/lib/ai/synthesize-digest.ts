import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type {
  DigestInputs,
  RecommendedAction,
} from "@/lib/types/insights";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export const synthesisSchema = z.object({
  strategic_brief: z.string().min(30),
  recommended_actions: z
    .array(
      z.object({
        priority: z.number().int().min(1).max(3),
        action: z.string().min(5),
        target_module: z
          .enum([
            "/intel-feed",
            "/viral-trends",
            "/content-briefs",
            "/own-analytics",
            "/seo-tracker",
            "/leads",
            "/ai-content",
          ])
          .nullable(),
        rationale: z.string().min(5),
      })
    )
    .min(1)
    .max(5),
});

export type DigestSynthesis = z.infer<typeof synthesisSchema>;

interface SynthesizeInput {
  voice: BrandVoice | null;
  data: DigestInputs;
}

export async function synthesizeDigest(
  input: SynthesizeInput
): Promise<{ synthesis: DigestSynthesis; costUsd: number }> {
  const started = Date.now();
  const { voice, data } = input;

  const voiceBlock = voice
    ? [
        "Brand voice:",
        `- Tone: ${voice.tone}`,
        `- Audience: ${voice.audience}`,
      ].join("\n")
    : "No brand voice configured — keep it plainspoken.";

  const system = [
    `You write a weekly strategic brief for ${data.tenantName}.`,
    voiceBlock,
    "",
    "Your job:",
    "- Read the structured week-in-review data below.",
    "- Output strategic_brief: 3-5 sentences that tell a COHERENT story about the week (what competitors did, how we did, what the opportunity is). Specific, not generic. No filler.",
    "- Output recommended_actions: 3-5 actions ranked by priority (1 = most urgent). Each action has a target_module (where to act in the app) and a rationale (one sentence — why this action, grounded in the data).",
    "",
    "Rules:",
    "- Don't invent numbers. Only reference what's in the data.",
    "- If own_performance shows 0 posts, say 'No own-post metrics imported this week' in the brief.",
    "- If a data block is empty, don't pretend it has substance.",
    "- Actions should be concrete: 'Shoot a TikTok venue reveal this weekend' beats 'Create more video content'.",
    "- target_module must be null if no app page fits the action.",
    "- Return ONLY JSON matching the schema.",
  ].join("\n");

  const user = [
    `Week of: ${data.weekOf}`,
    "",
    "== TOP COMPETITOR MOVES ==",
    data.topCompetitorMoves.length === 0
      ? "(none this week)"
      : data.topCompetitorMoves
          .map(
            (m) =>
              `- ${m.competitor_name} on ${m.platform} (${m.content_type}, ${m.multiplier?.toFixed(1) ?? "?"}x): ${m.why_notable}`
          )
          .join("\n"),
    "",
    "== WINNING FORMATS (cross-competitor) ==",
    data.winningFormats.length === 0
      ? "(none detected)"
      : data.winningFormats
          .map((f) => `- ${f.format} avg ${f.multiplier}x — ${f.evidence}`)
          .join("\n"),
    "",
    "== OWN PERFORMANCE ==",
    `Posts this week: ${data.ownPerformance.posts_this_week}`,
    `Reach this week: ${data.ownPerformance.reach_this_week.toLocaleString()}`,
    `Reach prior week: ${data.ownPerformance.reach_prior_week.toLocaleString()}`,
    data.ownPerformance.pct_change !== null
      ? `Change: ${data.ownPerformance.pct_change > 0 ? "+" : ""}${data.ownPerformance.pct_change}%`
      : "Change: n/a (no prior week data)",
    data.ownPerformance.top_post
      ? `Top post: "${data.ownPerformance.top_post.title ?? "(untitled)"}" — ${data.ownPerformance.top_post.reach.toLocaleString()} reach`
      : "Top post: n/a",
    "",
    "== SEO ==",
    `Tracked keywords: ${data.seoSummary.tracked_total}`,
    `Top 10: ${data.seoSummary.top10} · Rising: ${data.seoSummary.rising} · Declining: ${data.seoSummary.declining}`,
    `Avg position: ${data.seoSummary.avg_position ?? "n/a"} (change ${data.seoSummary.avg_position_change ?? "n/a"})`,
    "",
    "== LEADS ==",
    `Active: ${data.leadsSummary.total_active} · New warm: ${data.leadsSummary.new_warm} · Need follow-up: ${data.leadsSummary.needs_followup} · Converted this week: ${data.leadsSummary.converted_this_week}`,
    "",
    "Write the strategic_brief and recommended_actions.",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: synthesisSchema }),
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
      tenantSlug: data.tenantSlug,
      purpose: "synthesis",
      feature: "digest_synthesize",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    // Normalize: cast priority to 1|2|3 union
    const synthesis: DigestSynthesis = {
      strategic_brief: result.output.strategic_brief,
      recommended_actions: result.output.recommended_actions.map(
        (a) =>
          ({
            priority: Math.max(1, Math.min(3, a.priority)) as 1 | 2 | 3,
            action: a.action,
            target_module: a.target_module,
            rationale: a.rationale,
          }) as RecommendedAction
      ),
    };
    return { synthesis, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: data.tenantSlug,
      purpose: "synthesis",
      feature: "digest_synthesize",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
