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
  | "analysis" // structured data extraction (e.g. parsing JSON/HTML exports)
  | "embedding" // vector embeddings for dedup (Phase E)
  | "transcription" // Whisper voice-feedback (Phase D)
  | "vision" // screenshot OCR / post-metrics extraction
  | "seo-longform" // SEO blog generation (Phase SEO/Phase 1)
  | "seo-scoring" // SEO recommendation scoring / title rewrites
  | "seo-embedding" // 1536-dim post embeddings for internal-link suggestions
  | "video-storyboard" // structure an approved plan/post into Seedance clips
  | "video-generate"; // media generation (Seedance via PicsArt) — log axis only

export function getModel(purpose: Purpose): LanguageModel {
  switch (purpose) {
    case "synthesis":
    case "video-storyboard":
      // Storyboard structuring is a synthesis task (plan/post → ordered
      // clips); same model as other long-form synthesis.
      return openai("gpt-4.1");
    case "scoring":
    case "analysis":
      // Scoring is a rating task with structured output — the deterministic
      // half of the rubric anchors the final number, so the AI half just
      // needs to grade 0-5 per criterion. gpt-4o-mini is ~13x cheaper
      // than 4.1 and more than capable here. Revisit if rubric tuning
      // exposes rating drift.
      // Analysis (e.g. JSON/HTML export parsing) is also a cheap structured
      // extraction task with the same model profile.
      return openai("gpt-4o-mini");
    case "vision":
      return openai("gpt-4o");
    case "seo-longform":
      // Long-form SEO drafts. gpt-5 picked over gpt-4.1 for stronger
      // structure on competitor-context-heavy prompts. Re-benchmark
      // after 30 drafts via /benchmark-models; consider Anthropic
      // Opus only if quality gap is measurable.
      return openai("gpt-5");
    case "seo-scoring":
      // Same logic as 'scoring' — cheap rater, structured output.
      return openai("gpt-4o-mini");
    case "embedding":
    case "seo-embedding":
    case "transcription":
    case "video-generate":
      // These purposes don't use LanguageModel — they have their own
      // call paths (embedText / Whisper / the VideoProvider for video-generate).
      // getModel is a no-op sentinel for them.
      return openai("gpt-4.1");
  }
}

export function getModelId(purpose: Purpose): string {
  switch (purpose) {
    case "synthesis":
    case "transcription":
    case "video-storyboard":
      return "openai/gpt-4.1";
    case "scoring":
    case "analysis":
    case "seo-scoring":
      return "openai/gpt-4o-mini";
    case "vision":
      return "openai/gpt-4o";
    case "seo-longform":
      return "openai/gpt-5";
    case "embedding":
      return "openai/text-embedding-3-large";
    case "seo-embedding":
      return "openai/text-embedding-3-large";
    case "video-generate":
      // Media generation logs an explicit provider model on each call; this
      // sentinel is unused by callers.
      return "picsart/seedance-2.0";
  }
}

// Published rates as of 2026. Update if OpenAI changes pricing.
// text-embedding-3-large is priced per 1M input tokens only (no output);
// modeled as input-only here so estimateCostUsd works without a special case.
const COST_PER_MTOK: Record<
  string,
  { input: number; output: number; cache_read: number }
> = {
  "openai/gpt-4.1": { input: 2, output: 8, cache_read: 0.5 },
  "openai/gpt-4o": { input: 2.5, output: 10, cache_read: 1.25 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cache_read: 0.075 },
  "openai/gpt-5": { input: 1.25, output: 10, cache_read: 0.125 },
  "openai/text-embedding-3-large": { input: 0.13, output: 0, cache_read: 0 },
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
  /** Provider credits for media generation (video) rows. Null for LLM rows. */
  credits?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
}

/** Convert provider credits to USD for media-generation telemetry. */
export function creditsToUsd(credits: number, creditUsd: number): number {
  return credits * creditUsd;
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
    credits: entry.credits ?? null,
    duration_ms: entry.durationMs,
    success: entry.success,
    error_message: entry.errorMessage ?? null,
  });
}
