// Rules-based aggregation over the week. Pure SQL queries, no AI.
// Produces structured inputs the LLM turns into prose strategic brief.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { startOfWeekSaturday } from "@/lib/util/week-of";
import type {
  CompetitorMove,
  WinningFormat,
  OwnPerformance,
  SeoSummary,
  LeadsSummary,
  WeeklyDigestRecord,
} from "@/lib/types/insights";

interface Row {
  id: string;
  tenant_slug: string;
  week_of: string;
  strategic_brief: string | null;
  top_competitor_moves: CompetitorMove[] | null;
  winning_formats: WinningFormat[] | null;
  recommended_actions: unknown;
  own_performance: OwnPerformance | null;
  seo_summary: SeoSummary | null;
  leads_summary: LeadsSummary | null;
  // Populated by the separate "weekly business review" generator
  // (src/lib/actions/weekly-reviews.ts), which upserts into the same
  // weekly_digests row but only ever sets these two columns — the
  // rules-based digest columns above (own_performance/seo_summary/
  // leads_summary/strategic_brief) then keep their JSONB `{}`/NULL
  // column defaults (migration 016) rather than being null outright,
  // which is why they render as truthy-but-undefined without this guard.
  narrative: string | null;
  generator_model: string | null;
  generator_cost_usd: string | null;
  generated_at: string;
}

/** DB defaults these JSONB columns to `{}` rather than NULL, so an
 * un-populated column round-trips as a truthy-but-empty object instead
 * of null. Treat "no keys" the same as "no data" so the UI's `own &&`
 * guards behave correctly instead of rendering undefined fields. */
function nullIfEmpty<T extends object>(v: T | null | undefined): T | null {
  if (!v || Object.keys(v).length === 0) return null;
  return v;
}

function rowTo(row: Row): WeeklyDigestRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    weekOf: row.week_of,
    // Fall back to the business-review narrative when the rules-based
    // digest pass never ran for this week (see Row.narrative comment).
    strategicBrief: row.strategic_brief ?? row.narrative ?? null,
    topCompetitorMoves: row.top_competitor_moves ?? [],
    winningFormats: row.winning_formats ?? [],
    recommendedActions: (row.recommended_actions ?? []) as WeeklyDigestRecord["recommendedActions"],
    ownPerformance: nullIfEmpty(row.own_performance),
    seoSummary: nullIfEmpty(row.seo_summary),
    leadsSummary: nullIfEmpty(row.leads_summary),
    generatorModel: row.generator_model,
    generatorCostUsd: row.generator_cost_usd ? Number(row.generator_cost_usd) : 0,
    generatedAt: row.generated_at,
  };
}

export async function getLatestDigest(
  tenantSlug: string
): Promise<WeeklyDigestRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_digests")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}

export async function listDigests(
  tenantSlug: string,
  limit = 12
): Promise<WeeklyDigestRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_digests")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("week_of", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

// =========================================================================
// Rules-based aggregators (pure data; no AI).
// Called by cron + by action. Use admin client so cron (no user context)
// can still query tenant tables.
// =========================================================================

interface IntelCardRow {
  id: string;
  competitor_name: string;
  platform: string;
  content_type: string;
  metrics: { vsAverage?: number | null; engagementRate?: number; views?: number } | null;
  summary: string;
}

export async function aggregateCompetitorMoves(
  tenantSlug: string,
  weekStart: Date
): Promise<CompetitorMove[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("intel_cards")
    .select("id, competitor_name, platform, content_type, metrics, summary")
    .eq("tenant_id", tenantSlug)
    .gte("detected_at", weekStart.toISOString())
    .order("detected_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as IntelCardRow[];
  return rows
    .filter((r) => (r.metrics?.vsAverage ?? 0) > 1.2)
    .sort((a, b) => (b.metrics?.vsAverage ?? 0) - (a.metrics?.vsAverage ?? 0))
    .slice(0, 5)
    .map((r) => ({
      intel_card_id: r.id,
      competitor_name: r.competitor_name,
      platform: r.platform,
      content_type: r.content_type,
      why_notable: r.summary.slice(0, 200),
      multiplier: r.metrics?.vsAverage ?? null,
    }));
}

export async function aggregateWinningFormats(
  tenantSlug: string,
  weekStart: Date
): Promise<WinningFormat[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("intel_cards")
    .select("platform, content_type, metrics, competitor_name")
    .eq("tenant_id", tenantSlug)
    .gte("detected_at", weekStart.toISOString());

  const rows = (data ?? []) as IntelCardRow[];
  const groups = new Map<string, { cards: IntelCardRow[]; platform: string; type: string }>();
  for (const row of rows) {
    const key = `${row.platform}|${row.content_type}`;
    const bucket = groups.get(key) ?? {
      cards: [],
      platform: row.platform,
      type: row.content_type,
    };
    bucket.cards.push(row);
    groups.set(key, bucket);
  }

  const out: WinningFormat[] = [];
  for (const { cards, platform, type } of groups.values()) {
    if (cards.length < 2) continue;
    const vs = cards
      .map((c) => c.metrics?.vsAverage ?? 0)
      .filter((v) => v > 0);
    if (vs.length === 0) continue;
    const avgMult = vs.reduce((s, v) => s + v, 0) / vs.length;
    if (avgMult < 1.5) continue;
    out.push({
      format: `${platform} ${type}`,
      platform,
      evidence: cards
        .slice(0, 3)
        .map((c) => `${c.competitor_name} (${(c.metrics?.vsAverage ?? 0).toFixed(1)}x)`)
        .join(", "),
      multiplier: Number(avgMult.toFixed(1)),
    });
  }
  return out.sort((a, b) => b.multiplier - a.multiplier).slice(0, 3);
}

export async function aggregateOwnPerformance(
  tenantSlug: string,
  weekStart: Date
): Promise<OwnPerformance> {
  const admin = createAdminClient();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const priorStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: thisWeek } = await admin
    .from("own_post_metrics")
    .select("title, metrics")
    .eq("tenant_slug", tenantSlug)
    .gte("captured_at", weekStart.toISOString())
    .lt("captured_at", weekEnd.toISOString());

  const { data: priorWeek } = await admin
    .from("own_post_metrics")
    .select("metrics")
    .eq("tenant_slug", tenantSlug)
    .gte("captured_at", priorStart.toISOString())
    .lt("captured_at", weekStart.toISOString());

  type MetricRow = { title: string | null; metrics: Record<string, number> | null };
  const thisRows = (thisWeek ?? []) as MetricRow[];
  const priorRows = (priorWeek ?? []) as Pick<MetricRow, "metrics">[];

  const reachOf = (m: Record<string, number> | null): number =>
    (m?.reach ?? m?.views ?? m?.impressions ?? 0) as number;

  const reachThis = thisRows.reduce((s, r) => s + reachOf(r.metrics), 0);
  const reachPrior = priorRows.reduce((s, r) => s + reachOf(r.metrics), 0);

  let topPost: OwnPerformance["top_post"] = null;
  let worstPost: OwnPerformance["worst_post"] = null;
  if (thisRows.length > 0) {
    const sorted = [...thisRows].sort((a, b) => reachOf(b.metrics) - reachOf(a.metrics));
    const top = sorted[0];
    const worst = sorted[sorted.length - 1];
    topPost = { title: top.title, reach: reachOf(top.metrics) };
    if (sorted.length > 1) {
      worstPost = { title: worst.title, reach: reachOf(worst.metrics) };
    }
  }

  const pct =
    reachPrior > 0 ? ((reachThis - reachPrior) / reachPrior) * 100 : null;

  return {
    posts_this_week: thisRows.length,
    reach_this_week: reachThis,
    reach_prior_week: reachPrior,
    pct_change: pct !== null ? Number(pct.toFixed(1)) : null,
    top_post: topPost,
    worst_post: worstPost,
  };
}

export async function aggregateSeoSummary(
  tenantSlug: string
): Promise<SeoSummary> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("keyword_rankings")
    .select("position, previous_position")
    .eq("tenant_slug", tenantSlug);

  const rows = (data ?? []) as Array<{
    position: number | null;
    previous_position: number | null;
  }>;
  const ranked = rows.filter((r) => r.position !== null);
  const positions = ranked.map((r) => r.position as number);
  const avgPos = positions.length
    ? positions.reduce((s, p) => s + p, 0) / positions.length
    : null;

  const rising = rows.filter(
    (r) =>
      r.position !== null &&
      r.previous_position !== null &&
      r.previous_position > r.position
  ).length;
  const declining = rows.filter(
    (r) =>
      r.position !== null &&
      r.previous_position !== null &&
      r.previous_position < r.position
  ).length;

  const prevRanked = rows.filter((r) => r.previous_position !== null);
  const prevPositions = prevRanked.map((r) => r.previous_position as number);
  const prevAvg = prevPositions.length
    ? prevPositions.reduce((s, p) => s + p, 0) / prevPositions.length
    : null;
  const avgChange =
    avgPos !== null && prevAvg !== null ? Number((prevAvg - avgPos).toFixed(1)) : null;

  const top10 = ranked.filter((r) => (r.position ?? 999) <= 10).length;

  return {
    tracked_total: rows.length,
    rising,
    declining,
    avg_position: avgPos !== null ? Number(avgPos.toFixed(1)) : null,
    avg_position_change: avgChange,
    top10,
  };
}

export async function aggregateLeadsSummary(
  tenantSlug: string,
  weekStart: Date
): Promise<LeadsSummary> {
  const admin = createAdminClient();
  const { data: leads } = await admin
    .from("leads")
    .select("status, created_at, updated_at")
    .eq("tenant_slug", tenantSlug);

  type Row = { status: string; created_at: string; updated_at: string };
  const rows = (leads ?? []) as Row[];
  const weekStartIso = weekStart.toISOString();

  const activeStatuses = ["new", "contacted", "warm"];
  const totalActive = rows.filter((r) => activeStatuses.includes(r.status)).length;
  const newWarm = rows.filter(
    (r) => r.status === "warm" && r.updated_at >= weekStartIso
  ).length;
  const needsFollowup = rows.filter((r) => r.status === "new").length;
  const convertedThisWeek = rows.filter(
    (r) => r.status === "converted" && r.updated_at >= weekStartIso
  ).length;

  return {
    total_active: totalActive,
    new_warm: newWarm,
    needs_followup: needsFollowup,
    converted_this_week: convertedThisWeek,
  };
}

export function weekOfSaturday(now: Date = new Date()): string {
  return startOfWeekSaturday(now).toISOString().slice(0, 10);
}
