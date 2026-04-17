import { createClient } from "@/lib/supabase/server";

export interface AiUsageSummary {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
  cacheHitRate: number; // 0-1 — read / (read + written + uncached input)
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
}

export interface AiCallRow {
  id: string;
  createdAt: string;
  purpose: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  durationMs: number | null;
  success: boolean;
  errorMessage: string | null;
}

interface LogRow {
  id: string;
  created_at: string;
  purpose: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: string | null;
  duration_ms: number | null;
  success: boolean;
  error_message: string | null;
}

function monthStart(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getAiUsageSummary(
  tenantSlug: string
): Promise<AiUsageSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_call_log")
    .select("model, success, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms")
    .eq("tenant_slug", tenantSlug)
    .gte("created_at", monthStart().toISOString());

  if (error || !data) {
    return {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCostUsd: 0,
      avgDurationMs: 0,
      cacheHitRate: 0,
      byModel: [],
    };
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let success = 0;
  let failed = 0;
  const modelAgg = new Map<string, { calls: number; costUsd: number }>();

  for (const row of data) {
    totalInput += row.input_tokens ?? 0;
    totalOutput += row.output_tokens ?? 0;
    totalCacheRead += row.cache_read_tokens ?? 0;
    totalCacheWrite += row.cache_write_tokens ?? 0;
    totalCost += Number(row.cost_usd ?? 0);
    totalDuration += row.duration_ms ?? 0;
    if (row.success) success += 1;
    else failed += 1;
    const prev = modelAgg.get(row.model) ?? { calls: 0, costUsd: 0 };
    prev.calls += 1;
    prev.costUsd += Number(row.cost_usd ?? 0);
    modelAgg.set(row.model, prev);
  }

  const totalCalls = data.length;
  // Cache hit rate: cached-read tokens / total input tokens sent to model.
  // totalInput already includes cache reads + writes + fresh tokens in AI SDK's accounting.
  const hitRate = totalInput > 0 ? totalCacheRead / totalInput : 0;

  return {
    totalCalls,
    successCalls: success,
    failedCalls: failed,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheWriteTokens: totalCacheWrite,
    totalCostUsd: totalCost,
    avgDurationMs: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
    cacheHitRate: hitRate,
    byModel: Array.from(modelAgg.entries())
      .map(([model, v]) => ({ model, calls: v.calls, costUsd: v.costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

export async function getRecentAiCalls(
  tenantSlug: string,
  limit = 20
): Promise<AiCallRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_call_log")
    .select("id, created_at, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, success, error_message")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as LogRow[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    purpose: r.purpose,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    costUsd: r.cost_usd !== null ? Number(r.cost_usd) : null,
    durationMs: r.duration_ms,
    success: r.success,
    errorMessage: r.error_message,
  }));
}
