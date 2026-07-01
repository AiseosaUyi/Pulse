import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  OwnPostMetric,
  OwnMetricsPlatform,
  OwnMetricsSource,
  OwnMetricsPayload,
  ImportSession,
} from "@/lib/types/own-metrics";

interface Row {
  id: string;
  tenant_slug: string;
  post_id: string | null;
  platform: OwnMetricsPlatform;
  external_url: string | null;
  title: string | null;
  caption: string | null;
  captured_at: string;
  source: OwnMetricsSource;
  metrics: OwnMetricsPayload | null;
  created_at: string;
  import_batch_id: string | null;
}

interface SessionRow {
  id: string;
  tenant_slug: string;
  platform: string;
  post_count: number;
  period_start: string | null;
  period_end: string | null;
  imported_at: string;
  label: string | null;
}

function rowTo(row: Row): OwnPostMetric {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    postId: row.post_id,
    platform: row.platform,
    externalUrl: row.external_url,
    title: row.title,
    caption: row.caption,
    capturedAt: row.captured_at,
    source: row.source,
    metrics: row.metrics ?? {},
    createdAt: row.created_at,
    importBatchId: row.import_batch_id,
  };
}

function sessionRowTo(row: SessionRow): ImportSession {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    platform: row.platform,
    postCount: row.post_count,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    importedAt: row.imported_at,
    label: row.label,
  };
}

export async function listOwnMetrics(
  tenantSlug: string,
  options: { platform?: OwnMetricsPlatform; limit?: number; batchId?: string } = {}
): Promise<OwnPostMetric[]> {
  const supabase = await createClient();
  let query = supabase
    .from("own_post_metrics")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("captured_at", { ascending: false })
    .limit(options.limit ?? 2000);
  if (options.platform) query = query.eq("platform", options.platform);
  if (options.batchId) query = query.eq("import_batch_id", options.batchId);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function listImportSessions(
  tenantSlug: string,
  platform?: string
): Promise<ImportSession[]> {
  const admin = createAdminClient();
  let query = admin
    .from("analytics_import_sessions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("imported_at", { ascending: false })
    .limit(50);
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as SessionRow[]).map(sessionRowTo);
}

export interface OwnMetricsSummary {
  totalPosts: number;
  perPlatform: Array<{
    platform: OwnMetricsPlatform;
    posts: number;
    totalReach: number;
    totalEngagement: number;
    avgEngagementRate: number;
  }>;
  weeklyReach: number;
  weeklyEngagement: number;
}

export async function getOwnMetricsSummary(
  tenantSlug: string
): Promise<OwnMetricsSummary> {
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("own_post_metrics")
    .select("platform, captured_at, metrics")
    .eq("tenant_slug", tenantSlug);

  if (error || !data) {
    return {
      totalPosts: 0,
      perPlatform: [],
      weeklyReach: 0,
      weeklyEngagement: 0,
    };
  }

  const byPlatform = new Map<
    OwnMetricsPlatform,
    { posts: number; reach: number; engagement: number; erSum: number; erCount: number }
  >();
  let weeklyReach = 0;
  let weeklyEngagement = 0;

  for (const row of data as Array<{
    platform: OwnMetricsPlatform;
    captured_at: string;
    metrics: OwnMetricsPayload | null;
  }>) {
    const m = row.metrics ?? {};
    const reach = m.reach ?? m.views ?? 0;
    const engagement =
      (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
    const bucket = byPlatform.get(row.platform) ?? {
      posts: 0,
      reach: 0,
      engagement: 0,
      erSum: 0,
      erCount: 0,
    };
    bucket.posts += 1;
    bucket.reach += reach;
    bucket.engagement += engagement;
    if (m.engagement_rate !== undefined) {
      bucket.erSum += m.engagement_rate;
      bucket.erCount += 1;
    }
    byPlatform.set(row.platform, bucket);

    if (row.captured_at >= weekAgo) {
      weeklyReach += reach;
      weeklyEngagement += engagement;
    }
  }

  return {
    totalPosts: data.length,
    perPlatform: Array.from(byPlatform.entries()).map(([platform, v]) => ({
      platform,
      posts: v.posts,
      totalReach: v.reach,
      totalEngagement: v.engagement,
      avgEngagementRate: v.erCount > 0 ? v.erSum / v.erCount : 0,
    })),
    weeklyReach,
    weeklyEngagement,
  };
}
