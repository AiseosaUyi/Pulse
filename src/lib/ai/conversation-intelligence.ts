// Conversation Intelligence — analyzes a prospect's full message thread
// and returns: stage, intent, follow-up recommendation, objection detection,
// business opportunity flags (Gruve / Sippoy), and risk level.
//
// Uses gpt-4.1-mini ("outreach-analysis" purpose) — strong enough for
// reasoning over short conversation threads, ~5x cheaper than gpt-4.1.

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import {
  getBrandContext,
  buildPositioningBlock,
} from "@/lib/ai/brand-positioning";
import type { ProspectRecord } from "@/lib/types/outbound";
import type { ConversationStage, ObjectionCategory, RiskLevel } from "@/lib/types/outreach-intelligence";

// ── Zod schema ──────────────────────────────────────────────────────────────
// All fields nullable (not optional) per OpenAI strict mode requirement.

export const conversationAnalysisSchema = z.object({
  conversation_stage: z
    .enum([
      "initial_contact",
      "interested",
      "objecting",
      "follow_up_requested",
      "cold",
      "converted",
      "lost",
    ])
    .describe(
      "Current stage of the conversation based on the thread."
    ),
  intent_summary: z
    .string()
    .min(10)
    .max(300)
    .describe(
      "1-sentence plain-English summary of where this conversation stands. E.g. 'They have a June event and asked us to follow up afterwards.'"
    ),
  recommended_wait_days: z
    .number()
    .int()
    .nullable()
    .describe(
      "How many days to wait before following up. Choose from: 0 (immediately), 3, 7, 14, 30, 60, 90. Null if no follow-up makes sense (e.g. lost)."
    ),
  recommended_follow_up_note: z
    .string()
    .max(200)
    .nullable()
    .describe(
      "Short note explaining WHEN and WHY to follow up. E.g. 'Reach out after their June 15 event'. Null if no follow-up."
    ),
  objection_detected: z
    .boolean()
    .describe("True if the prospect raised an objection."),
  objection_category: z
    .enum([
      "existing_provider",
      "timing",
      "price",
      "no_response",
      "not_interested",
      "other",
    ])
    .nullable()
    .describe("Category of objection, if any."),
  risk_level: z
    .enum(["low", "medium", "high", "dead"])
    .describe(
      "Risk that we lose this opportunity. dead = conversation is over permanently."
    ),
  gruve_relevant: z
    .boolean()
    .describe(
      "True if this prospect could benefit from Gruve (event ticketing). Look for: event organizer, festival, conference, university event, concert."
    ),
  sippoy_relevant: z
    .boolean()
    .describe(
      "True if this prospect could benefit from Sippoy (drinks distribution). Look for: wedding planner, event planner, restaurant, club, lounge, hospitality."
    ),
});

export type ConversationAnalysisAiResult = z.infer<
  typeof conversationAnalysisSchema
>;

export class ConversationIntelligenceError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ConversationIntelligenceError";
  }
}

// ── Input ────────────────────────────────────────────────────────────────────

export interface ThreadMessage {
  direction: "outbound" | "inbound";
  body: string;
  sentAt: string;
}

export interface AnalyzeConversationInput {
  tenantSlug: string;
  tenantName: string;
  prospect: ProspectRecord;
  /** Most recent messages first, capped at last 12 to keep prompt tight. */
  thread: ThreadMessage[];
}

// ── Main function ────────────────────────────────────────────────────────────

export async function analyzeConversationAi(
  input: AnalyzeConversationInput
): Promise<{
  result: ConversationAnalysisAiResult;
  model: string;
  costUsd: number;
}> {
  const model = getModel("outreach-analysis");
  const modelId = getModelId("outreach-analysis");
  const started = Date.now();

  const { voice, positioning } = await getBrandContext(input.tenantSlug);

  const system = buildSystem(input, { voice, positioning });
  const prompt = buildPrompt(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: conversationAnalysisSchema }),
      system,
      prompt,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "outreach-analysis",
      feature: "conversation_intelligence",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    return { result: result.output, model: modelId, costUsd };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "outreach-analysis",
      feature: "conversation_intelligence",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new ConversationIntelligenceError(
      "Failed to analyze conversation",
      err
    );
  }
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystem(
  input: AnalyzeConversationInput,
  ctx: { voice: unknown; positioning: unknown }
): string {
  const lines = [
    `You analyze outreach conversations for ${input.tenantName} and determine:`,
    "1. Where the conversation stands (stage)",
    "2. What the prospect's intent is (plain English summary)",
    "3. When to follow up, if at all",
    "4. Whether an objection was raised and what kind",
    "5. Risk level for losing this opportunity",
    "6. Which business (Gruve ticketing / Sippoy drinks) this lead is relevant for",
    "",
    "Rules:",
    "- Base everything on the actual messages. Do not invent context.",
    "- 'follow_up_requested' = they literally said to reach out at a specific time.",
    "- 'cold' = we sent messages but they never replied (no inbound messages in thread).",
    "- 'interested' = they replied positively without committing.",
    "- If they said 'reach out after X event', set recommended_wait_days based on that event date relative to today.",
    "- recommended_wait_days is a rough guide. Pick from: 0, 3, 7, 14, 30, 60, 90.",
    "- gruve_relevant: event organizers, festival/concert promoters, communities running events.",
    "- sippoy_relevant: wedding/event planners, restaurants, clubs, lounges, hospitality businesses.",
    "- A single lead can be relevant to both.",
    "",
    buildPositioningBlock(ctx.positioning as Parameters<typeof buildPositioningBlock>[0]),
  ];
  return lines.join("\n");
}

function buildPrompt(input: AnalyzeConversationInput): string {
  const { prospect, thread } = input;
  const lines = [
    `Prospect: @${prospect.handle} on ${prospect.platform}`,
    prospect.displayName ? `Name: ${prospect.displayName}` : "",
    prospect.bio ? `Bio: ${prospect.bio}` : "",
    prospect.signalSummary ? `Why discovered: ${prospect.signalSummary}` : "",
    "",
    "--- Conversation thread (newest first) ---",
  ];

  const capped = thread.slice(0, 12);
  for (const msg of capped) {
    const dir = msg.direction === "outbound" ? "US →" : "THEM →";
    lines.push(`${dir} ${msg.body.trim()}`);
  }

  if (thread.length === 0) {
    lines.push("(No messages yet — prospect is newly discovered.)");
  }

  lines.push("", "Analyze this conversation.");
  return lines.filter((l) => l !== "").join("\n");
}
