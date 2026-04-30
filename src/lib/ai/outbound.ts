// Outbound AI — two jobs:
//   1. Qualify a prospect (is this person worth DMing for us?)
//   2. Draft a DM in the brand's voice that fits the platform's norms
//
// Both run as cheap structured-output calls.

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
import type {
  OutboundPlatform,
  ProspectRecord,
} from "@/lib/types/outbound";
import type { OutboundFilters } from "@/lib/types/outbound-filters";

// ──────────────────────────────────────────────────────────
// Qualifier
// ──────────────────────────────────────────────────────────

export const qualifySchema = z.object({
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "0-100 likelihood this prospect is worth reaching out to. 85+ = definitely, 60-84 = maybe, <60 = skip."
    ),
  reason: z
    .string()
    .min(20)
    .max(400)
    .describe(
      "2-3 sentences explaining the score. Reference the signal and the brand fit specifically."
    ),
  persona: z
    .string()
    .describe(
      "One-line who-they-are label — 'Lagos wedding planner with 2 recent events'."
    ),
  should_reach_out: z.boolean(),
});

export type QualifyResult = z.infer<typeof qualifySchema>;

export class OutboundAiError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "OutboundAiError";
  }
}

export interface QualifyInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  /**
   * User-configured outbound filters (keywords + geo + competitors).
   * Optional — when null, the qualifier falls back to brand context
   * only. Call sites that want sharper scoring should load via
   * getOutboundFilters(tenantSlug) and pass it through.
   */
  filters?: OutboundFilters | null;
  prospect: ProspectRecord;
}

export async function qualifyProspectAi(
  input: QualifyInput
): Promise<{ result: QualifyResult; model: string; costUsd: number }> {
  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  const system = buildQualifySystem(input);
  const user = buildQualifyUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: qualifySchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "outbound_qualify",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return { result: result.output, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "outbound_qualify",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new OutboundAiError("Failed to qualify prospect", err);
  }
}

function buildQualifySystem(input: QualifyInput): string {
  const { tenantName, voice, positioning, filters } = input;
  const lines = [
    `You screen prospects for ${tenantName} before we DM them. Score 0-100 and justify.`,
    "",
    "Rules:",
    "- A high score means the prospect matches our audience AND has a recent activation signal (posted, attending an event, asking in public).",
    "- Penalize competitors (other vendors/planners — NOT buyers), bots, inactive accounts, celebrities/influencers obviously outside our reach.",
    "- 85+ means 'worth a personalized DM from a human'. Reserve it.",
    "- The `reason` must cite the concrete signal, not generic affirmations.",
    "- Weigh capture sources: `post_author` (strongest — they posted publicly), `commenter` (medium — public intent comment on-topic), `tagged` (weaker — someone else tagged them), `opportunistic`/`manual` (weakest — no surrounding context).",
  ];
  if (filters) {
    if (filters.keywords.length > 0) {
      lines.push(
        "",
        `Event-intent keywords of interest: ${filters.keywords.slice(0, 80).join(", ")}. Presence in bio or intent_quote is a strong positive.`
      );
    }
    if (filters.geoScope.length > 0) {
      const geo = filters.geoScope
        .map(
          (g) =>
            `${g.country}${g.states.length > 0 ? ` (${g.states.slice(0, 12).join(", ")}${g.states.length > 12 ? ", ..." : ""})` : ""}`
        )
        .join("; ");
      lines.push(
        "",
        `Geographic scope: ${geo}. If the bio or intent_quote mentions a specific location OUTSIDE this scope, cap the score under 50.`
      );
    }
    if (filters.competitorUrls.length > 0) {
      lines.push(
        "",
        `Competitor event platforms: ${filters.competitorUrls.join(", ")}. If the prospect's bio or captured post links to any of these, treat it as a POACH opportunity — bump the score notably and call it out in the reason.`
      );
    }
  }
  if (voice) lines.push("", `Audience: ${voice.audience}`);
  lines.push("", buildPositioningBlock(positioning));
  return lines.join("\n");
}

function buildQualifyUser(input: QualifyInput): string {
  const { prospect } = input;
  const signalData = (prospect.signalData ?? {}) as Record<string, unknown>;
  const sourceType =
    typeof signalData.source_type === "string"
      ? (signalData.source_type as string)
      : null;
  const intentQuote =
    typeof signalData.intent_quote === "string"
      ? (signalData.intent_quote as string)
      : null;
  const capturedFrom =
    typeof signalData.captured_from_url === "string"
      ? (signalData.captured_from_url as string)
      : null;
  const localQualify =
    signalData.local_qualify && typeof signalData.local_qualify === "object"
      ? (signalData.local_qualify as {
          matchedKeywords?: string[];
          matchedCompetitors?: string[];
          matchedGeo?: string[];
          verdict?: string;
        })
      : null;
  const localSummary = localQualify
    ? [
        localQualify.matchedKeywords?.length
          ? `keywords=${localQualify.matchedKeywords.join("|")}`
          : "",
        localQualify.matchedCompetitors?.length
          ? `competitors=${localQualify.matchedCompetitors.join("|")}`
          : "",
        localQualify.matchedGeo?.length
          ? `geo=${localQualify.matchedGeo.join("|")}`
          : "",
        localQualify.verdict ? `verdict=${localQualify.verdict}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return [
    `Platform: ${prospect.platform}`,
    `Handle: @${prospect.handle}`,
    prospect.displayName ? `Display name: ${prospect.displayName}` : "",
    prospect.followerCount != null
      ? `Followers: ${prospect.followerCount.toLocaleString()}`
      : "",
    prospect.bio ? `Bio: ${prospect.bio}` : "",
    sourceType ? `Source type: ${sourceType}` : "",
    intentQuote ? `Intent quote: ${intentQuote}` : "",
    capturedFrom ? `Captured from: ${capturedFrom}` : "",
    prospect.signalSummary ? `Signal: ${prospect.signalSummary}` : "",
    localSummary ? `Local pre-score: ${localSummary}` : "",
    Object.keys(signalData).length
      ? `Signal data: ${JSON.stringify(signalData).slice(0, 800)}`
      : "",
    "",
    "Score and justify.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ──────────────────────────────────────────────────────────
// DM Drafter
// ──────────────────────────────────────────────────────────

export const draftDmSchema = z.object({
  body: z
    .string()
    .min(20)
    .describe(
      "The DM itself. Max 400 chars on IG / 280 on Twitter / 500 on LinkedIn. Pick per platform. Personalized to the signal. Never starts with 'Hi'. Ends with a low-commitment question."
    ),
  followup_body: z
    .string()
    .nullable()
    .describe(
      "Optional 2-sentence follow-up if no reply in 3 days. Null if inappropriate (e.g. event already passed)."
    ),
  rationale: z
    .string()
    .describe("1-2 sentences explaining the angle chosen."),
});

export type DraftDmResult = z.infer<typeof draftDmSchema>;

export interface DraftDmInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  prospect: ProspectRecord;
  /** Optional priority signal — 'new event in 2 weeks', etc. */
  context?: string;
}

const MAX_LENGTH_BY_PLATFORM: Record<OutboundPlatform, string> = {
  instagram: "IG DMs from non-followers are capped tight — keep under 400 chars.",
  tiktok: "TikTok DMs are short — keep under 300 chars.",
  twitter: "Twitter DMs — keep under 280 chars.",
  linkedin: "LinkedIn connection notes are capped at 300 chars — keep it under that.",
  manual: "Short and punchy — assume a DM-sized box.",
  other: "Short and punchy — assume a DM-sized box.",
};

export async function draftOutboundDmAi(
  input: DraftDmInput
): Promise<{ result: DraftDmResult; model: string; costUsd: number }> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildDraftSystem(input);
  const user = buildDraftUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: draftDmSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "outbound_draft_dm",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return { result: result.output, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "outbound_draft_dm",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new OutboundAiError("Failed to draft DM", err);
  }
}

function buildDraftSystem(input: DraftDmInput): string {
  const { tenantName, voice, positioning, prospect } = input;
  const lines = [
    `You write cold DMs for ${tenantName}. Sound like a human doing outbound who actually read the prospect's profile — not like marketing.`,
    "",
    "Rules:",
    "- Personalize to the signal in the first sentence. Reference their post, event, or recent activity specifically.",
    "- Never open with 'Hi [name]' or 'Hope you're well'. Start with something that proves you did your homework.",
    "- End with ONE low-commitment question. Not a pitch, not a meeting ask.",
    "- No emoji unless the brand voice says we use them.",
    "- Never mention prices, never promise specific outcomes, never imply existing relationship.",
    "- Platform constraint: " + MAX_LENGTH_BY_PLATFORM[prospect.platform],
  ];
  if (voice) {
    lines.push(
      "",
      "Brand voice:",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`,
      `- Do: ${voice.do_list.join(" | ")}`,
      `- Don't: ${voice.dont_list.join(" | ")}`
    );
  }
  lines.push("", buildPositioningBlock(positioning));
  return lines.join("\n");
}

function buildDraftUser(input: DraftDmInput): string {
  const { prospect, context } = input;
  return [
    `Platform: ${prospect.platform}`,
    `Prospect: @${prospect.handle}${
      prospect.displayName ? ` (${prospect.displayName})` : ""
    }`,
    prospect.bio ? `Bio: ${prospect.bio}` : "",
    prospect.signalSummary ? `Signal: ${prospect.signalSummary}` : "",
    prospect.qualificationReason
      ? `Qualifier notes: ${prospect.qualificationReason}`
      : "",
    context ? `Additional context: ${context}` : "",
    "",
    "Draft the DM.",
  ]
    .filter(Boolean)
    .join("\n");
}
