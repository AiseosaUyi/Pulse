// AI layer for the individual-persona content calendar: picks today's/next
// topic, then generates a grounded research briefing (talking points, a
// sourced stat, a contrarian angle, reference links). Two calls per slot,
// not one — the briefing call is grounded in REAL search results fetched
// between the two calls (same "deterministic gathering feeds a synthesis
// call" pattern as intel_cards → content_briefs), so a stat/fact always
// carries a real source URL rather than a hallucinated one (design doc
// ENG REVIEW, locked decision #12).
//
// Deferred, NOT built here: a formal LLM eval suite (locked decision #7 —
// the founder's own manual usage over the next 2-3 weeks is the eval).

import { generateText, Output } from "ai";
import { z } from "zod";
import { estimateCostUsd, getModel, getModelId, logAiCall } from "@/lib/ai/gateway";
import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";
import type { TrendCandidate } from "@/lib/scrape/trend-pull";
import type { ContentSlotBrief } from "@/lib/types/content-calendar";

export class ContentCalendarAiError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ContentCalendarAiError";
  }
}

const topicSelectSchema = z.object({
  topicTitle: z.string().min(3).describe("A specific, compelling topic framed as something to talk about on camera — not a generic category."),
  searchQuery: z.string().min(3).describe("A search query to find real reference articles/discussion about this exact topic."),
});

const briefingSchema = z.object({
  talkingPoints: z.array(z.string()).describe("3-5 concrete talking points for a 30-90s short-form video on this topic. Empty array if truly nothing usable."),
  stat: z.string().nullable().describe("One surprising, specific stat or fact drawn from the provided ARTICLE sources, or null if none of the sources contain one."),
  statSourceUrl: z.string().nullable().describe("Must be exactly one of the provided ARTICLE source URLs that the stat came from. Null if stat is null."),
  contrarianAngle: z.string().nullable().describe("A genuine counter-take or contrarian angle on the topic, or null if none fits."),
  referenceLinks: z.array(z.object({
    url: z.string().describe("Must be one of the provided ARTICLE source URLs."),
    title: z.string(),
  })).describe("Up to 2 of the provided ARTICLE sources worth reading before filming. Empty array if none are usable."),
  noReferencesFound: z.boolean().describe("true if none of the provided ARTICLE sources were usable for this topic."),
  creatorExamples: z.array(z.object({
    url: z.string().describe("Must be one of the provided CREATOR/SOCIAL source URLs."),
    title: z.string(),
  })).describe("Up to 2 of the provided CREATOR/SOCIAL sources — real posts/videos other creators made about this topic. Empty array if none are usable."),
  noCreatorExamplesFound: z.boolean().describe("true if none of the provided CREATOR/SOCIAL sources were usable — common, since social platforms are weakly indexed by search; not an error."),
});

export interface GenerateSlotContentInput {
  tenantSlug: string;
  niche: string;
  interestTags: string[]; // empty array → trend-only fallback (locked decision #9)
  trends: TrendCandidate[];
  excludeTitles: string[]; // already-picked topics earlier in this same batch (locked decision #4)
}

export interface GenerateSlotContentResult {
  topicTitle: string;
  brief: ContentSlotBrief;
}

export async function generateSlotContent(
  input: GenerateSlotContentInput
): Promise<GenerateSlotContentResult> {
  const { topicTitle, searchQuery } = await selectTopic(input);
  const brief = await generateBriefing({
    tenantSlug: input.tenantSlug,
    topicTitle,
    searchQuery,
  });
  return { topicTitle, brief };
}

// Exported for reuse by generateNextBatch, which calls this SEQUENTIALLY
// (not through mapWithConcurrency) so each pick genuinely sees every prior
// pick before choosing — see the note at that call site for why: with
// concurrency, multiple topic-selection calls fire in parallel before any
// of them can see each other's pick, and duplicate/rephrased topics slip
// through (confirmed live, 2026-07-09 — 3 of 5 slots in one batch were the
// same underlying story rephrased 3 ways).
export async function selectTopic(
  input: GenerateSlotContentInput
): Promise<{ topicTitle: string; searchQuery: string }> {
  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  const trendLines = input.trends
    .slice(0, 15)
    .map((t) => `- ${t.title} (${t.source}${t.points ? `, ${t.points} pts` : ""})`)
    .join("\n");

  const systemLines = [
    `You pick ONE topic per call for a solo creator's daily short-form video in the ${input.niche} niche.`,
    "Rules:",
    "- Prefer a topic from the trending candidates list below when one fits the creator's interests.",
    "- If the interest list is empty, pick straight from trends — a real, specific trend beats a generic one.",
    "- Never repeat or closely rephrase a topic already picked earlier in this batch (listed below).",
    "- The topic must be specific enough to talk about for 30-90s, not a vague category.",
  ];
  if (input.interestTags.length > 0) {
    systemLines.push("", `Creator's stated interests: ${input.interestTags.join(", ")}`);
  }
  if (input.excludeTitles.length > 0) {
    systemLines.push("", "Already picked this batch — do NOT repeat or closely rephrase these:", input.excludeTitles.map((t) => `- ${t}`).join("\n"));
  }

  const userLines = [
    "Trending candidates:",
    trendLines || "(none found)",
    "",
    "Pick one topic and a search query to find reference material for it.",
  ];

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: topicSelectSchema }),
      system: systemLines.join("\n"),
      prompt: userLines.join("\n"),
      // Bounds a single slow/stuck LLM call so it can't consume the whole
      // batch's runtime budget (confirmed live, 2026-07-09: without this,
      // a batch could exceed the route's maxDuration and the platform
      // killed the whole request with a 503, before anything was saved).
      timeout: 45_000,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = estimateCostUsd(modelId, { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "content_calendar_topic_select",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "content_calendar_topic_select",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new ContentCalendarAiError("Failed to select a topic", err);
  }
}

// Exported so generateNextBatch can fan this out CONCURRENTLY across all
// N already-selected topics — safe to parallelize, unlike topic selection,
// since briefing generation has no cross-slot dependency.
export async function generateBriefing(input: {
  tenantSlug: string;
  topicTitle: string;
  searchQuery: string;
}): Promise<ContentSlotBrief> {
  let sources: Array<{ url: string; title: string; snippet: string }> = [];
  try {
    const results = await scrapeGoogleSerp({ query: input.searchQuery, region: "us", limit: 5 });
    sources = results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
  } catch (err) {
    console.warn(`[content-calendar] reference search failed for "${input.searchQuery}"`, err);
  }

  // "What others are doing" — a SEPARATE, explicitly site-restricted pass
  // targeting real creator posts/videos, not generic web articles. Search
  // engines index short-form video/social content weakly (confirmed live
  // during eng review — expect this to come back thin or empty often;
  // that's normal, not a bug, hence noCreatorExamplesFound rather than an
  // error state).
  let creatorSources: Array<{ url: string; title: string; snippet: string }> = [];
  try {
    const results = await scrapeGoogleSerp({
      query: `${input.topicTitle} (site:tiktok.com OR site:youtube.com/shorts OR site:instagram.com/reel OR site:x.com)`,
      region: "us",
      limit: 5,
    });
    creatorSources = results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
  } catch (err) {
    console.warn(`[content-calendar] creator-content search failed for "${input.topicTitle}"`, err);
  }

  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const sourceLines = sources.length
    ? sources.map((s, i) => `[A${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`).join("\n\n")
    : "(no article sources found)";
  const creatorSourceLines = creatorSources.length
    ? creatorSources.map((s, i) => `[C${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`).join("\n\n")
    : "(no creator/social sources found)";

  const systemLines = [
    "You write a short pre-filming research briefing for a solo creator's short-form video.",
    "Rules:",
    "- Base talking points, the stat, and reference links ONLY on the provided ARTICLE sources below — never invent a fact, stat, or URL not present in them.",
    "- If a stat isn't clearly present in any article source, set stat and statSourceUrl to null rather than guessing.",
    "- statSourceUrl, if not null, MUST be exactly one of the provided ARTICLE source URLs.",
    "- referenceLinks entries MUST be chosen from the provided ARTICLE sources, not invented.",
    "- If none of the article sources are usable for this topic, set noReferencesFound to true and return an empty referenceLinks array.",
    "- creatorExamples MUST be chosen from the provided CREATOR/SOCIAL sources only, not invented and not article sources.",
    "- If none of the creator/social sources are usable, set noCreatorExamplesFound to true and return an empty creatorExamples array — this is common and fine, do not force a match.",
  ];

  const userLines = [
    `Topic: ${input.topicTitle}`,
    "",
    "ARTICLE sources:",
    sourceLines,
    "",
    "CREATOR/SOCIAL sources (real posts/videos, if any were found):",
    creatorSourceLines,
  ];

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: briefingSchema }),
      system: systemLines.join("\n"),
      prompt: userLines.join("\n"),
      timeout: 45_000,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = estimateCostUsd(modelId, { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "content_calendar_briefing",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "content_calendar_briefing",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new ContentCalendarAiError("Failed to generate briefing", err);
  }
}
