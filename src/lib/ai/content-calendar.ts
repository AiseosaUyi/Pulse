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

const CONTENT_FORMATS = [
  "teardown",
  "how_to",
  "hot_take",
  "personal_story",
  "listicle",
  "news_reaction",
] as const;

const topicSelectSchema = z.object({
  topicTitle: z.string().min(3).describe("A specific, compelling topic framed as something to talk about on camera — not a generic category."),
  searchQuery: z.string().min(3).describe("A search query to find real reference articles/discussion about this exact topic."),
  pillar: z.string().describe("Exactly one of the creator's given content pillars — verbatim — that this topic belongs to."),
  format: z.enum(CONTENT_FORMATS).describe(
    "The video's content format: teardown (break down a specific example), how_to (step-by-step), hot_take (opinion/contrarian take), personal_story (your own build/experience), listicle (a numbered list), news_reaction (reacting to one specific news item)."
  ),
});

const briefingSchema = z.object({
  whyItMatters: z.string().describe("ONE plain-language sentence on why this topic is worth talking about right now. Write for someone who may be new to this specific topic — orient them before the talking points below assume any context."),
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
  niches: string[]; // content pillars — the AI picks one per topic and spreads a batch across them
  interestTags: string[]; // empty array → trend-only fallback (locked decision #9)
  trends: TrendCandidate[];
  excludeTitles: string[]; // already-picked topics earlier in this same batch (locked decision #4)
  usedPillars?: string[]; // pillars already used this batch/queue — nudges rotation, not a hard exclude
  // When set, the caller has already round-robined this slot to a specific
  // pillar (see buildPillarAssignments in actions/content-calendar.ts) and
  // the model MUST use it — a hard lock, not a "prefer" nudge. Without this,
  // pillar coverage was purely voluntary and drifted to whichever pillar
  // had the richest trend material (confirmed live: some configured pillars
  // never appeared in a batch at all).
  assignedPillar?: string;
  usedFormats?: string[]; // content formats already used this batch — nudges variety, same pattern as usedPillars
  instruction?: string; // one-off steering from the creator (batch-level "generate with instructions", or a stated reason on regenerate)
  // Rolling log of past regenerate reasons — the immediate half of the
  // "learning loop" (senior-uiux audit stage 05): lets topic selection
  // notice a pattern ("too technical" said twice for AI tools) without
  // waiting on post-performance data that doesn't exist yet.
  recentFeedback?: Array<{ reason: string; pillar: string | null }>;
}

export interface GenerateSlotContentResult {
  topicTitle: string;
  brief: ContentSlotBrief;
}

export async function generateSlotContent(
  input: GenerateSlotContentInput
): Promise<GenerateSlotContentResult> {
  const { topicTitle, searchQuery, pillar, format } = await selectTopic(input);
  const brief = await generateBriefing({
    tenantSlug: input.tenantSlug,
    topicTitle,
    searchQuery,
    pillar,
    format,
    instruction: input.instruction,
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
): Promise<{ topicTitle: string; searchQuery: string; pillar: string; format: (typeof CONTENT_FORMATS)[number] }> {
  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  // Callers doing batch generation pre-filter `trends` down to the
  // assigned pillar's own trend pool before calling this (see
  // buildPillarAssignments in actions/content-calendar.ts) — showing the
  // model only relevant-pillar material instead of a globally flattened
  // top-15 that structurally favored whichever pillar's fetch returned the
  // most/richest results (confirmed live: pillars listed later, or with
  // thinner trend coverage, never surfaced in generated batches at all).
  const trendLines = input.trends
    .slice(0, 15)
    .map((t) => `- ${t.title} (${t.source}${t.points ? `, ${t.points} pts` : ""})`)
    .join("\n");

  const systemLines = [
    `You pick ONE topic per call for a solo creator's daily short-form video, whose content spans these pillars: ${input.niches.join(", ")}.`,
    "Rules:",
    "- Prefer a topic from the trending candidates list below when one fits the creator's interests.",
    "- If the interest list is empty, pick straight from trends — a real, specific trend beats a generic one.",
    "- Never repeat or closely rephrase a topic already picked earlier in this batch, already sitting in the queue, or already posted (all listed below).",
    "- The topic must be specific enough to talk about for 30-90s, not a vague category.",
    "- Avoid template phrasings like \"The Role of AI in Shaping X\" or \"The Evolution of AI-Native Y\" — vary sentence structure from pick to pick.",
    "- Pick a `format` that fits the topic; favor a format different from ones already used recently (listed below) when it still fits naturally.",
  ];
  if (input.assignedPillar) {
    systemLines.push(
      "",
      `HARD REQUIREMENT: this topic MUST belong to the pillar "${input.assignedPillar}" — report it verbatim in \`pillar\`. Do not substitute a different pillar even if another trends harder.`
    );
  } else {
    systemLines.push("- Pick exactly one pillar from that list for this topic and report it verbatim in `pillar`.");
    if (input.niches.length > 1) {
      systemLines.push("- Spread coverage across pillars over a batch — don't default to the same pillar every time just because it trends more.");
    }
  }
  if (input.interestTags.length > 0) {
    systemLines.push("", `Creator's stated interests: ${input.interestTags.join(", ")}`);
  }
  if (input.excludeTitles.length > 0) {
    systemLines.push("", "Already picked this batch, queued, or posted — do NOT repeat or closely rephrase these:", input.excludeTitles.map((t) => `- ${t}`).join("\n"));
  }
  if (!input.assignedPillar && input.usedPillars && input.usedPillars.length > 0) {
    systemLines.push("", `Pillars already used recently (prefer a different one if it fits): ${input.usedPillars.join(", ")}`);
  }
  if (input.usedFormats && input.usedFormats.length > 0) {
    systemLines.push("", `Formats already used recently (prefer a different one if it fits): ${input.usedFormats.join(", ")}`);
  }
  if (input.recentFeedback && input.recentFeedback.length > 0) {
    systemLines.push(
      "",
      "Creator's recent feedback on past topics — weigh this in (e.g. if they keep saying a pillar is too technical, favor a simpler entry point in it this time):",
      input.recentFeedback
        .slice(-5)
        .map((f) => `- "${f.reason}"${f.pillar ? ` (pillar: ${f.pillar})` : ""}`)
        .join("\n")
    );
  }
  if (input.instruction && input.instruction.trim()) {
    systemLines.push("", `Creator's instruction for this pick — follow it even if it overrides the above: ${input.instruction.trim()}`);
  }

  const userLines = [
    "Trending candidates:",
    trendLines || "(none found)",
    "",
    "Pick one topic, its pillar, and a search query to find reference material for it.",
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

    // Belt-and-suspenders: the hard-lock instruction above should already
    // make the model report the assigned pillar verbatim, but a model quirk
    // returning a paraphrase of it would silently break the coverage
    // guarantee the caller is relying on — force it rather than trust prose
    // compliance for something load-bearing.
    if (input.assignedPillar) {
      return { ...result.output, pillar: input.assignedPillar };
    }
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
  pillar?: string;
  format?: string;
  instruction?: string;
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
  const creatorSiteFilter = "(site:tiktok.com OR site:youtube.com/shorts OR site:instagram.com/reel OR site:x.com)";
  try {
    const results = await scrapeGoogleSerp({
      query: `${input.topicTitle} ${creatorSiteFilter}`,
      region: "us",
      limit: 5,
    });
    creatorSources = results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
  } catch (err) {
    console.warn(`[content-calendar] creator-content search failed for "${input.topicTitle}"`, err);
  }

  // Fallback: the exact topic title (often "X: Y" phrasing) is frequently
  // too specific for weakly-indexed social platforms to match. Retry once
  // with just the leading clause instead — a broader phrase has better
  // odds of surfacing something, rather than leaving this the least
  // reliable section of the panel for the exact person who needs it most.
  if (creatorSources.length === 0) {
    const broaderPhrase = input.topicTitle.split(":")[0].trim();
    if (broaderPhrase && broaderPhrase !== input.topicTitle) {
      try {
        const results = await scrapeGoogleSerp({
          query: `${broaderPhrase} ${creatorSiteFilter}`,
          region: "us",
          limit: 5,
        });
        creatorSources = results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
      } catch (err) {
        console.warn(`[content-calendar] broader creator-content search failed for "${broaderPhrase}"`, err);
      }
    }
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
    "- whyItMatters must be ONE sentence, plain language, assuming the viewer AND the creator may be new to this specific topic — orient before informing.",
    "- Base talking points, the stat, and reference links ONLY on the provided ARTICLE sources below — never invent a fact, stat, or URL not present in them.",
    "- If a stat isn't clearly present in any article source, set stat and statSourceUrl to null rather than guessing.",
    "- statSourceUrl, if not null, MUST be exactly one of the provided ARTICLE source URLs.",
    "- referenceLinks entries MUST be chosen from the provided ARTICLE sources, not invented.",
    "- If none of the article sources are usable for this topic, set noReferencesFound to true and return an empty referenceLinks array.",
    "- creatorExamples MUST be chosen from the provided CREATOR/SOCIAL sources only, not invented and not article sources.",
    "- If none of the creator/social sources are usable, set noCreatorExamplesFound to true and return an empty creatorExamples array — this is common and fine, do not force a match.",
  ];
  if (input.instruction && input.instruction.trim()) {
    systemLines.push("", `Creator's instruction for this briefing — follow it: ${input.instruction.trim()}`);
  }

  const userLines = [
    `Topic: ${input.topicTitle}`,
    ...(input.format ? [`Format: ${input.format}`] : []),
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

    return { ...result.output, pillar: input.pillar ?? null, format: input.format ?? null };
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
