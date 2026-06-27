// Reads the last 30 days of Intel Feed (competitor cards with high vsAverage)
// and generates brand-voice draft posts to populate the calendar.
// Each post includes a caption, stock image search query, and shoot direction.

import { z } from "zod";
import { generateText, Output } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBrandContext,
  buildPositioningBlock,
} from "@/lib/ai/brand-positioning";
import { getModel, getModelId, logAiCall, estimateCostUsd } from "@/lib/ai/gateway";

const PostSuggestionSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "linkedin", "youtube"]),
  format: z.string().nullable(),
  caption: z.string(),
  hook: z.string().nullable(),
  image_search_query: z.string().nullable(),
  shoot_direction: z.string().nullable(),
  suggested_day_offset: z.number(),
  rationale: z.string().nullable(),
});

const OutputSchema = z.object({
  posts: z.array(PostSuggestionSchema),
});

export type IntelPostSuggestion = z.infer<typeof PostSuggestionSchema>;

export async function generatePostsFromIntel(
  tenantSlug: string
): Promise<IntelPostSuggestion[]> {
  const admin = createAdminClient();
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  // Fetch high-performing intel cards
  const { data: cards } = await admin
    .from("intel_cards")
    .select(
      "competitor_name, platform, content_type, summary, metrics, ai_recommendation"
    )
    .eq("tenant_id", tenantSlug)
    .gte("detected_at", thirtyDaysAgo)
    .order("detected_at", { ascending: false })
    .limit(50);

  if (!cards?.length) return [];

  // Filter to top performers (3x+ avg) or take top 5 by vsAverage
  type CardRow = {
    competitor_name: string;
    platform: string;
    content_type: string;
    summary: string;
    metrics: { vsAverage?: number; views?: number; engagement?: number } | null;
    ai_recommendation: { analysis?: string; action?: string } | null;
  };

  const sorted = (cards as CardRow[])
    .filter((c) => (c.metrics?.vsAverage ?? 0) >= 2)
    .sort((a, b) => (b.metrics?.vsAverage ?? 0) - (a.metrics?.vsAverage ?? 0))
    .slice(0, 8);

  if (!sorted.length) {
    // Fall back to most recent 5 if none hit 2x threshold
    const fallback = (cards as CardRow[]).slice(0, 5);
    sorted.push(...fallback);
  }

  const intelSummary = sorted
    .map(
      (c, i) =>
        `${i + 1}. ${c.competitor_name} on ${c.platform} (${c.content_type}) — ${c.metrics?.vsAverage ? `${c.metrics.vsAverage}x avg engagement` : "notable post"}. Summary: ${c.summary}${c.ai_recommendation?.analysis ? `. AI note: ${c.ai_recommendation.analysis}` : ""}`
    )
    .join("\n");

  const { voice, positioning } = await getBrandContext(tenantSlug);

  const voiceBlock = voice
    ? `Brand voice: ${voice.tone ?? ""} — target audience: ${voice.audience ?? ""}`.trim()
    : "Brand voice: professional, engaging";

  const positioningBlock = buildPositioningBlock(positioning);

  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const start = Date.now();
  let success = false;
  let errorMessage: string | undefined;
  let result: { posts: IntelPostSuggestion[] } | null = null;

  try {
    const textResult = await generateText({
      model,
      output: Output.object({ schema: OutputSchema }),
      messages: [
        {
          role: "user",
          content: `You are a social media strategist. Based on what's working for competitors, generate 5-7 draft posts for this brand.

${voiceBlock}
${positioningBlock}

TOP PERFORMING COMPETITOR CONTENT (last 30 days):
${intelSummary}

Generate 5-7 posts that:
1. Use similar formats and energy to what's working above
2. Are completely original — no competitor name mentions, no copying their specific content
3. Are in the brand's own voice and positioning
4. Spread across platforms (instagram, tiktok, x, linkedin — pick what fits each idea)
5. Have varied day offsets (0 through 6) so they spread across the week

For EACH post provide:
- platform (instagram|tiktok|x|linkedin|youtube)
- format ("Reel" | "Thread" | "Carousel" | "Post" | "Story")
- caption (the full post text, ready to publish)
- hook (the opening line / hook — what stops the scroll)
- image_search_query (a specific Unsplash/Pexels search term for the right image, e.g. "cocktail bar rooftop Lagos night lights")
- shoot_direction (brief content direction if they film it themselves, e.g. "3-second slow-pan Reel revealing the full bar from entrance door")
- suggested_day_offset (number 0 through 6, which day of the next 7 to post this)
- rationale (1 sentence: which competitor signal inspired this and why it will work)

Return 5-7 posts. No placeholders — every field should be specific and ready to use.`,
        },
      ],
    });

    success = true;
    result = textResult.output as { posts: IntelPostSuggestion[] };
    const usage = textResult.usage;

    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "intel_calendar_generate",
      model: modelId,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: estimateCostUsd(modelId, {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      }),
      durationMs: Date.now() - start,
      success: true,
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "intel_calendar_generate",
      model: modelId,
      durationMs: Date.now() - start,
      success: false,
      errorMessage,
    });
    throw err;
  }

  void success; // logged above
  void errorMessage;

  return result?.posts ?? [];
}
