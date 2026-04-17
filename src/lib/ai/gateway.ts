import { createAdminClient } from "@/lib/supabase/admin";

type Purpose = "synthesis";

export function getModelId(purpose: Purpose): string {
  switch (purpose) {
    case "synthesis":
      return "anthropic/claude-sonnet-4.6";
  }
}

const COST_PER_MTOK: Record<
  string,
  { input: number; output: number; cache_read: number; cache_write: number }
> = {
  "anthropic/claude-sonnet-4.6": {
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write: 3.75,
  },
};

export function estimateCostUsd(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }
): number {
  const rates = COST_PER_MTOK[model];
  if (!rates) return 0;
  const m = 1_000_000;
  const uncachedInput =
    usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0);
  return (
    (uncachedInput * rates.input +
      usage.outputTokens * rates.output +
      (usage.cacheReadTokens ?? 0) * rates.cache_read +
      (usage.cacheWriteTokens ?? 0) * rates.cache_write) /
    m
  );
}

export interface AiCallLogEntry {
  tenantSlug: string;
  purpose: Purpose;
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
