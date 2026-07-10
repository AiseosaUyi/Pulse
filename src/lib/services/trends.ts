import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TrendScout,
  TrendPlatform,
  TrendSource,
  TrendMetrics,
  TrendAnalysis,
  TrendApplicability,
} from "@/lib/types/trends";

interface Row {
  id: string;
  tenant_slug: string;
  platform: TrendPlatform;
  source: TrendSource;
  hashtag: string | null;
  external_url: string | null;
  title: string | null;
  summary: string;
  metrics: TrendMetrics | null;
  ai_analysis: TrendAnalysis | null;
  applicability: TrendApplicability | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  captured_at: string;
  created_at: string;
}

function rowTo(row: Row): TrendScout {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    platform: row.platform,
    source: row.source,
    hashtag: row.hashtag,
    externalUrl: row.external_url,
    title: row.title,
    summary: row.summary,
    metrics: row.metrics ?? {},
    aiAnalysis: row.ai_analysis,
    applicability: row.applicability,
    dismissedAt: row.dismissed_at,
    dismissedReason: row.dismissed_reason,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

export async function listTrendScouts(
  tenantSlug: string,
  options: {
    includeDismissed?: boolean;
    platform?: TrendPlatform;
    source?: TrendSource;
    limit?: number;
  } = {}
): Promise<TrendScout[]> {
  const supabase = await createClient();
  let query = supabase
    .from("trend_scouts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("captured_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (!options.includeDismissed) query = query.is("dismissed_at", null);
  if (options.platform) query = query.eq("platform", options.platform);
  if (options.source) query = query.eq("source", options.source);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

/** Client-injected, offset-paginated twin of listTrendScouts() for
 * /api/v1 + MCP — listTrendScouts() itself is left untouched (its 3
 * existing callers only need a `limit`, not a real total/offset). */
export async function listTrendScoutsApi(
  client: SupabaseClient,
  tenantSlug: string,
  filter: {
    includeDismissed?: boolean;
    platform?: TrendPlatform;
    source?: TrendSource;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: TrendScout[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  let query = client
    .from("trend_scouts")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .order("captured_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (!filter.includeDismissed) query = query.is("dismissed_at", null);
  if (filter.platform) query = query.eq("platform", filter.platform);
  if (filter.source) query = query.eq("source", filter.source);
  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };
  return { data: (data as Row[]).map(rowTo), total: count ?? 0 };
}

export async function getTrendScout(
  tenantSlug: string,
  id: string
): Promise<TrendScout | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trend_scouts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}
