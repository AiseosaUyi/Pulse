// Weekly Business Review — synthesizes everything Pulse did this
// week into one tight narrative + a ranked "do this next" list.
// Reads real counts off each module before the AI call so the model
// doesn't have to guess numbers.

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

export const weeklyReviewSchema = z.object({
  narrative: z
    .string()
    .min(80)
    .max(1600)
    .describe(
      "One paragraph, 120-250 words, written AS the brand's head of marketing reporting to the operator. Concrete numbers first, implications second. No generic openers like 'I hope you're well'."
    ),
  wins: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("1-5 specific things that actually moved this week."),
  drags: z
    .array(z.string())
    .max(5)
    .describe("0-5 specific things that underperformed or slipped."),
  next_week_focus: z
    .array(
      z.object({
        title: z.string().max(120),
        why: z.string().max(280),
      })
    )
    .min(1)
    .max(3)
    .describe("Top 1-3 priorities for next week. Concrete. Actionable."),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "How confident the review is, given the data. `low` when most modules are still silent."
    ),
});

export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;

export class WeeklyReviewError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "WeeklyReviewError";
  }
}

export interface WeeklyReviewInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  weekOf: string; // YYYY-MM-DD
  /** Aggregated counts / highlights across every module. */
  payload: {
    content: {
      blogs_published: number;
      blogs_drafted: number;
      distributions_approved: number;
      top_blog_title?: string;
      top_blog_score?: number;
    };
    publish: {
      wordpress_posts: number;
      ghost_posts: number;
      ayrshare_sends: number;
      failed: number;
    };
    outbound: {
      prospects_added: number;
      qualified: number;
      sent: number;
      replied: number;
      handed_off: number;
    };
    coach: {
      generated: number;
      completed: number;
      pending: number;
    };
    ads: {
      critiques_run: number;
    };
    analytics: {
      pageviews: number;
      sessions: number;
      users: number;
      conversions: number;
      top_pages: Array<{ path: string; pageviews: number }>;
      available: boolean;
    };
    spend: {
      ai_cost_usd: number;
    };
  };
}

export interface WeeklyReviewResult {
  review: WeeklyReview;
  model: string;
  costUsd: number;
}

export async function synthesizeWeeklyReview(
  input: WeeklyReviewInput
): Promise<WeeklyReviewResult> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildSystem(input);
  const user = buildUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: weeklyReviewSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cacheRead =
      ((result.providerMetadata?.openai ?? {}) as { cachedPromptTokens?: number })
        .cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "weekly_business_review",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return { review: result.output, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "weekly_business_review",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new WeeklyReviewError("Failed to synthesize weekly review", err);
  }
}

function buildSystem(input: WeeklyReviewInput): string {
  const { tenantName, voice, positioning } = input;
  const lines = [
    `You are ${tenantName}'s head of marketing. Write the weekly business review for the operator.`,
    "",
    "Rules:",
    "- Lead with a concrete number. 'We drafted 34 DMs; 18 were sent; 4 replied' beats 'outreach went well'.",
    "- Never congratulate generically. If there's nothing worth celebrating, say so.",
    "- `confidence` reflects data density. If half the modules have zeroes, say `low`.",
    "- `next_week_focus` must be something a single operator can start Monday morning, not strategy platitudes.",
    "- No filler. No 'I hope you're well'. No 'As you know'.",
  ];
  if (voice) {
    lines.push(
      "",
      "Voice:",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`
    );
  }
  lines.push("", buildPositioningBlock(positioning));
  return lines.join("\n");
}

function buildUser(input: WeeklyReviewInput): string {
  const { weekOf, payload } = input;
  const lines: string[] = [
    `Week of: ${weekOf}`,
    "",
    "=== CONTENT ===",
    `Blogs published: ${payload.content.blogs_published}`,
    `Blogs drafted (not published): ${payload.content.blogs_drafted}`,
    `Distribution artifacts approved: ${payload.content.distributions_approved}`,
    payload.content.top_blog_title
      ? `Top blog: "${payload.content.top_blog_title}"${
          payload.content.top_blog_score != null
            ? ` (score ${payload.content.top_blog_score}/100)`
            : ""
        }`
      : `No standout blog this week.`,
    "",
    "=== PUBLISHING ===",
    `WordPress posts: ${payload.publish.wordpress_posts}`,
    `Ghost posts: ${payload.publish.ghost_posts}`,
    `Social sends (Ayrshare): ${payload.publish.ayrshare_sends}`,
    payload.publish.failed > 0
      ? `Failures: ${payload.publish.failed} — worth investigating.`
      : "No publishing failures.",
    "",
    "=== OUTBOUND ===",
    `Prospects added: ${payload.outbound.prospects_added}`,
    `Qualified by AI: ${payload.outbound.qualified}`,
    `DMs sent: ${payload.outbound.sent}`,
    `Replies received: ${payload.outbound.replied}`,
    `Handed off to human: ${payload.outbound.handed_off}`,
    "",
    "=== COACH ===",
    `Actions generated: ${payload.coach.generated}`,
    `Completed: ${payload.coach.completed}`,
    `Still pending: ${payload.coach.pending}`,
    "",
    "=== ADS ===",
    `Ad critiques run: ${payload.ads.critiques_run}`,
    "",
    "=== WEB ANALYTICS (GA4) ===",
    payload.analytics.available
      ? [
          `Pageviews: ${payload.analytics.pageviews.toLocaleString()}`,
          `Sessions: ${payload.analytics.sessions.toLocaleString()}`,
          `Users: ${payload.analytics.users.toLocaleString()}`,
          `Conversions: ${payload.analytics.conversions.toLocaleString()}`,
          payload.analytics.top_pages.length > 0
            ? `Top pages: ${payload.analytics.top_pages
                .map((p) => `${p.path} (${p.pageviews.toLocaleString()} views)`)
                .join(", ")}`
            : "No page data yet.",
        ].join("\n")
      : "GA4 not connected — you're flying blind on what pages actually matter.",
    "",
    "=== COST ===",
    `AI spend this week: $${payload.spend.ai_cost_usd.toFixed(2)}`,
    "",
    "Write the weekly review.",
  ];
  return lines.join("\n");
}
