// LLM wrapper + call logging.
// Uses OpenAI direct (via @ai-sdk/openai). Swap to a different provider by
// editing getModel() and the cost table.
//
// `Purpose` is the model-selection axis — different capability classes
// may pick different models/settings. `feature` on the log entry is
// the analytics axis — what the call was FOR (blog_generate vs
// blog_score_alignment vs serp_analyze) so /settings/ai-usage can
// slice cost by capability, not just model.

import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";

export type Purpose =
  | "synthesis" // blog/brief/serp/trend/digest text generation
  | "scoring" // content-score sub-score rating
  | "embedding" // vector embeddings for dedup (Phase E)
  | "transcription" // Whisper voice-feedback (Phase D)
  | "vision"; // screenshot OCR / post-metrics extraction

export function getModel(purpose: Purpose): LanguageModel {
  switch (purpose) {
    case "synthesis":
      return openai("gpt-4.1");
    case "scoring":
      // Scoring doesn't need the creativity of synthesis; a smaller
      // model delivers the same rating quality at a fraction of the
      // cost. Kept on 4.1 for v1 so we don't couple rubric tuning to
      // a model swap. Revisit once the rubric is stable.
      return openai("gpt-4.1");
    case "vision":
      return openai("gpt-4o");
    case "embedding":
    case "transcription":
      // These purposes don't use LanguageModel — they have their own
      // call paths (embedText / Whisper). getModel is a no-op sentinel
      // for them. Callers that need actual clients should use their
      // purpose-specific helpers.
      return openai("gpt-4.1");
  }
}

export function getModelId(purpose: Purpose): string {
  switch (purpose) {
    case "synthesis":
    case "scoring":
    case "embedding":
    case "transcription":
      return "openai/gpt-4.1";
    case "vision":
      return "openai/gpt-4o";
  }
}

// Published rates as of 2026. Update if OpenAI changes pricing.
const COST_PER_MTOK: Record<
  string,
  { input: number; output: number; cache_read: number }
> = {
  "openai/gpt-4.1": { input: 2, output: 8, cache_read: 0.5 },
  "openai/gpt-4o": { input: 2.5, output: 10, cache_read: 1.25 },
  "openai/gpt-5": { input: 1.25, output: 10, cache_read: 0.125 },
};

export function estimateCostUsd(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
  }
): number {
  const rates = COST_PER_MTOK[model];
  if (!rates) return 0;
  const m = 1_000_000;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cacheRead);
  return (
    (uncachedInput * rates.input +
      usage.outputTokens * rates.output +
      cacheRead * rates.cache_read) /
    m
  );
}

export interface AiCallLogEntry {
  tenantSlug: string;
  purpose: Purpose;
  /** Capability slug for analytics — e.g. "blog_generate", "blog_score_alignment". */
  feature?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
}

export async function logAiCall(entry: AiCallLogEntry): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ai_call_log").insert({
    tenant_slug: entry.tenantSlug,
    purpose: entry.purpose,
    feature: entry.feature ?? null,
    model: entry.model,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    cache_read_tokens: entry.cacheReadTokens ?? 0,
    cache_write_tokens: entry.cacheWriteTokens ?? 0,
    cost_usd: entry.costUsd,
    duration_ms: entry.durationMs,
    success: entry.success,
    error_message: entry.errorMessage ?? null,
  });
}
