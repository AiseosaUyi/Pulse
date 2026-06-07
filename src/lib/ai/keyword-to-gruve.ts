import "server-only";
import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import {
  GRUVE_CATEGORIES,
  GRUVE_WHEN,
  heuristicMap,
  isGruveCategory,
  type GruveDiscoveryFilters,
  type GruveCategory,
  type GruveWhen,
} from "@/lib/seo/gruve-discovery";

const MODEL = "gpt-4o-mini"; // cheap classification — "scoring" tier
const MODEL_ID = `openai/${MODEL}`;

// .nullable() (not .optional()) per the OpenAI strict-output rule.
const mappingSchema = z.object({
  location: z.string().nullable(),
  category: z.enum(GRUVE_CATEGORIES).nullable(),
  when: z.enum(GRUVE_WHEN).nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export interface KeywordMapping extends GruveDiscoveryFilters {
  confidence: number;
  reasoning: string;
  source: "ai" | "heuristic";
}

/**
 * Map a search keyword to Gruve discovery filters, picking the CLOSEST
 * existing category (e.g. "raves" → "music"). Falls back to the
 * deterministic heuristic if the model is unavailable or errors.
 */
export async function mapKeywordToGruve(
  tenantSlug: string,
  keyword: string
): Promise<KeywordMapping> {
  const started = Date.now();
  const fallback = (): KeywordMapping => ({
    ...heuristicMap(keyword),
    confidence: 0.4,
    reasoning: "Heuristic token match (AI unavailable).",
    source: "heuristic",
  });

  const system = [
    "You map an event-search keyword to filters for Gruve's events listing.",
    "Return STRICT JSON matching the schema. Rules:",
    `- category MUST be one of: ${GRUVE_CATEGORIES.join(", ")} — or null if none fit.`,
    "  Pick the CLOSEST category. Examples: raves/parties/concerts/DJ/festival → music;",
    "  hackathon/startup → tech; web3/NFT → crypto; brunch/wine → food_drinks;",
    "  marathon/gym → sports_fitness; standup → comedy; exhibition → visual_art.",
    `- when MUST be one of: ${GRUVE_WHEN.join(", ")} — or null. weekend→weekend,`,
    "  tonight/today→today, friday/tgif→tgif, free→free, otherwise null.",
    "- location: the city/area if present (e.g. 'Lagos'), else null. Title-case it.",
    "- confidence 0..1. reasoning: one short sentence.",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: mappingSchema }),
      system,
      prompt: `Keyword: "${keyword}"`,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug,
      purpose: "scoring",
      feature: "keyword_to_gruve",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    const out = result.output;
    return {
      location: out.location?.trim() || null,
      category: (isGruveCategory(out.category) ? out.category : null) as GruveCategory | null,
      when: (out.when as GruveWhen | null) ?? null,
      confidence: out.confidence,
      reasoning: out.reasoning,
      source: "ai",
    };
  } catch (err) {
    await logAiCall({
      tenantSlug,
      purpose: "scoring",
      feature: "keyword_to_gruve",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return fallback();
  }
}
