// Post-generation quality judge for the content-calendar self-correcting
// loop (see generateNextBatch in actions/content-calendar.ts). Catches what
// generation-time prompting alone doesn't reliably prevent: a topic drifting
// off its assigned pillar, reading as company/startup marketing instead of
// personal-brand creator content, or echoing another title's sentence
// skeleton even though the words differ.
//
// Deliberately NOT per-candidate — one call judges a whole round (bounded
// by batch size, <=10) instead of N separate calls, to keep the loop's LLM
// call count sane (design constraint: total calls/cost must stay bounded).

import { generateText, Output } from "ai";
import { z } from "zod";
import { estimateCostUsd, getModel, getModelId, logAiCall } from "@/lib/ai/gateway";

const judgeVerdictSchema = z.object({
  index: z.number().int(),
  onLane: z.boolean().describe("True if the topic clearly and specifically belongs to its assigned pillar, not just tangentially related to it."),
  individualFit: z.boolean().describe(
    "True if this reads as first-person personal-brand/creator content for ONE individual building their own authority and reputation (opinions, walkthroughs, teardowns, \"how I do X\", hot takes, build stories). False for ANY company/product/startup marketing angle: product launches, \"we/our team\"/\"our company\" framing, corporate announcements, B2B startup-marketing pitches, or generic off-topic software-engineering/business/finance/news content that isn't actually about one of the creator's own pillars."
  ),
  templateOk: z.boolean().describe(
    "True if this title's sentence skeleton/structure is meaningfully different from every title listed in CONTEXT TITLES. False if it echoes the same template as one of them (e.g. \"The Role of AI in Shaping X\" and \"The Evolution of AI-Native Y\" are the SAME skeleton, just with different nouns)."
  ),
  reason: z.string().describe("One short sentence naming the specific failure(s). Empty string only if onLane, individualFit, AND templateOk are all true."),
});

const judgeSchema = z.object({
  verdicts: z.array(judgeVerdictSchema),
});

export interface JudgeCandidate {
  index: number;
  title: string;
  pillar: string;
  format: string;
}

export interface JudgeVerdict {
  index: number;
  onLane: boolean;
  individualFit: boolean;
  templateOk: boolean;
  pass: boolean;
  reason: string;
}

export async function judgeCandidates(input: {
  tenantSlug: string;
  niches: string[];
  currentYear: number;
  candidates: JudgeCandidate[];
  // Every other title to check skeleton collisions against — already-
  // accepted picks from earlier rounds PLUS the rest of this round's
  // candidates, so a collision is caught whichever side of the pair it's on.
  contextTitles: string[];
}): Promise<JudgeVerdict[]> {
  if (input.candidates.length === 0) return [];

  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  const systemLines = [
    "You are a strict quality judge for a solo creator's PERSONAL-BRAND content calendar. This creator is ONE individual building their own authority and reputation in their niche — NOT a company or startup.",
    `Configured content pillars: ${input.niches.join(", ")}.`,
    `Current year: ${input.currentYear}.`,
    "",
    "For EACH candidate below, judge three things:",
    "1. onLane — does the title clearly and specifically belong to its assigned pillar?",
    "2. individualFit — does it read as first-person creator content (opinion, walkthrough, teardown, \"how I do X\", hot take, build story)? REJECT anything reading like company/product/startup marketing: product launches, \"we/our team\"/\"our company\" framing, corporate announcements, B2B startup-marketing pitches, or generic off-topic software-engineering/business/finance/news content that isn't actually about one of the creator's own pillars.",
    "3. templateOk — does the title's sentence skeleton differ meaningfully from every title in CONTEXT TITLES? Fail it if it's just a reworded copy of the same structure.",
    "",
    "Be strict — when genuinely unsure, fail the check rather than let it slide.",
  ];

  const userLines = [
    "CANDIDATES to judge:",
    ...input.candidates.map((c) => `[${c.index}] "${c.title}" — pillar: ${c.pillar}, format: ${c.format}`),
    "",
    "CONTEXT TITLES (check templateOk against ALL of these):",
    input.contextTitles.length ? input.contextTitles.map((t) => `- ${t}`).join("\n") : "(none yet)",
  ];

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: judgeSchema }),
      system: systemLines.join("\n"),
      prompt: userLines.join("\n"),
      timeout: 45_000,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = estimateCostUsd(modelId, { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "content_calendar_judge",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    const byIndex = new Map(result.output.verdicts.map((v) => [v.index, v]));
    return input.candidates.map((c) => {
      const v = byIndex.get(c.index);
      if (!v) {
        return { index: c.index, onLane: false, individualFit: false, templateOk: false, pass: false, reason: "judge returned no verdict for this candidate" };
      }
      return { ...v, pass: v.onLane && v.individualFit && v.templateOk };
    });
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "content_calendar_judge",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Fail OPEN on a transient judge-call error (network/API failure), not
    // on a real quality failure — the deterministic checks (dedup, stale
    // year) already ran before this call. Failing closed here would let a
    // single flaky API call cascade into dropping an entire round every
    // time the judge itself is unreachable, deadlocking the batch instead
    // of just skipping one layer of (semantic) scrutiny for one round.
    console.warn("[content-calendar] judge call failed — accepting round by fallback", err);
    return input.candidates.map((c) => ({
      index: c.index,
      onLane: true,
      individualFit: true,
      templateOk: true,
      pass: true,
      reason: "judge call failed — accepted by fallback",
    }));
  }
}
