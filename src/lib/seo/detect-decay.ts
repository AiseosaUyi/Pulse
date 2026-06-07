// Content decay detection (PULSE-SEO-SPEC.md Pack C §10, detect-decay).
// Verbatim rubric from Gruve:
//   1. Per published slug: trailing 30-day clicks (MA30) + 90-day (MA90).
//   2. decay_score = 1 - (MA30 / MA90)   [moving AVERAGE per day —
//      using totals makes the ratio ~0.33 and always trips; interpreting
//      MAn as mean daily clicks over the window, which is the only
//      reading that makes the 0.25 threshold meaningful].
//   3. Flag if decay_score > 0.25 AND MA90 (90-day click total) > 50
//      (low-traffic false-positive guard).
//   4. SERP confirmation (top-3 vs publish-date snapshot) — ENHANCEMENT,
//      not gating; we have no reliable publish-date SERP snapshot, so
//      payload carries serp_confirmed:false rather than fabricating it.
//   5. Emit decay_alert. Cron: daily 08:00 UTC.
//
// Clicks source: Gruve C5 /api/pulse/engagement (canonical) → beacon
// rollup seo_post_engagement_daily (fallback). Both keyed by date+slug;
// `views` is the click proxy until GSC §7 is wired (keyword_capture's
// blocker, separate).

import { createAdminClient } from "@/lib/supabase/admin";
import { gruve, isGruveConfigured } from "@/lib/seo/gruve-client";

const DECAY_THRESHOLD = 0.25;
const MIN_MA90_CLICKS = 50;

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** date(YYYY-MM-DD) → clicks, last 90d, for one slug. */
async function clickSeries(
  supabase: ReturnType<typeof createAdminClient>,
  tenantSlug: string,
  slug: string
): Promise<Map<string, number>> {
  const from = isoDaysAgo(90);
  const to = isoDaysAgo(0);
  const series = new Map<string, number>();

  if (isGruveConfigured()) {
    try {
      const res = await gruve.engagement({ slug, from, to });
      for (const r of res.data)
        series.set(r.date, (series.get(r.date) ?? 0) + (r.views ?? 0));
      if (series.size > 0) return series;
    } catch {
      /* fall through */
    }
  }

  const { data } = await supabase
    .from("seo_post_engagement_daily")
    .select("date, views")
    .eq("tenant_slug", tenantSlug)
    .eq("slug", slug)
    .gte("date", from)
    .lte("date", to);
  for (const r of data ?? [])
    series.set(r.date as string, (r.views as number) ?? 0);
  return series;
}

export async function detectDecay(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const supabase = createAdminClient();
  const { data: posts } = await supabase
    .from("blog_posts")
    .select("id, tenant_slug, slug")
    .eq("status", "published")
    .not("slug", "is", null)
    .limit(500);

  const list = posts ?? [];
  const cut30 = isoDaysAgo(30);
  let flagged = 0;
  let failed = 0;

  for (const p of list) {
    try {
      const series = await clickSeries(supabase, p.tenant_slug, p.slug);
      if (series.size === 0) continue;

      let sum30 = 0;
      let sum90 = 0;
      for (const [date, clicks] of series) {
        sum90 += clicks;
        if (date >= cut30) sum30 += clicks;
      }
      const ma30 = sum30 / 30;
      const ma90 = sum90 / 90;
      if (ma90 <= 0) continue;
      const decayScore = 1 - ma30 / ma90;

      if (decayScore <= DECAY_THRESHOLD || sum90 <= MIN_MA90_CLICKS) continue;

      // One surfaced decay_alert per post.
      const { data: existing } = await supabase
        .from("seo_recommendations")
        .select("id")
        .eq("blog_post_id", p.id)
        .eq("type", "decay_alert")
        .eq("status", "surfaced")
        .limit(1);
      if (existing && existing.length > 0) continue;

      const { error } = await supabase.from("seo_recommendations").insert({
        tenant_slug: p.tenant_slug,
        blog_post_id: p.id,
        slug: p.slug,
        type: "decay_alert",
        payload: {
          decay_score: Number(decayScore.toFixed(3)),
          ma30_clicks_per_day: Number(ma30.toFixed(2)),
          ma90_clicks_per_day: Number(ma90.toFixed(2)),
          clicks_90d: sum90,
          serp_confirmed: false,
          reason: `30-day traffic down ${Math.round(
            decayScore * 100
          )}% vs 90-day baseline`,
        },
        score: Math.min(0.99, decayScore),
        status: "surfaced",
      });
      if (error) throw new Error(error.message);
      flagged++;
    } catch {
      failed++;
    }
  }

  return {
    status: failed > 0 ? "partial" : "ok",
    rowsProcessed: list.length,
    metadata: { flagged, failed, serp_confirmation: "pending-snapshots" },
  };
}
