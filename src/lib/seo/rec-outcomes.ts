// 30-day outcome capture (PULSE-SEO-SPEC.md §9, acceptance M4). Daily
// cron samples post metrics for applied recs whose outcome_due_at has
// passed and writes outcome_30d (current snapshot + delta vs baseline).
// This is the moat: without it we can never tell which rec types pay.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  snapshotPostMetrics,
  type PostMetricsSnapshot,
} from "@/lib/seo/post-metrics";

function delta(cur: PostMetricsSnapshot, base: PostMetricsSnapshot | null) {
  const b = base ?? null;
  const d = (k: keyof PostMetricsSnapshot) =>
    typeof cur[k] === "number" && b && typeof b[k] === "number"
      ? (cur[k] as number) - (b[k] as number)
      : null;
  return {
    pageviews: d("pageviews"),
    sessions: d("sessions"),
    users: d("users"),
    conversions: d("conversions"),
    avg_bounce_rate: d("avg_bounce_rate"),
  };
}

export async function captureDueOutcomes(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const supabase = createAdminClient();
  const { data: due } = await supabase
    .from("seo_recommendations")
    .select("id, tenant_slug, slug, baseline_30d")
    .lte("outcome_due_at", new Date().toISOString())
    .is("outcome_30d", null)
    .not("applied_at", "is", null)
    .limit(200);

  const recs = due ?? [];
  let captured = 0;
  let failed = 0;

  for (const rec of recs) {
    try {
      const current = await snapshotPostMetrics(
        supabase,
        rec.tenant_slug,
        rec.slug ?? ""
      );
      const baseline = (rec.baseline_30d ??
        null) as PostMetricsSnapshot | null;
      const { error } = await supabase
        .from("seo_recommendations")
        .update({
          outcome_30d: {
            ...current,
            baseline,
            delta: delta(current, baseline),
          },
        })
        .eq("id", rec.id);
      if (error) throw new Error(error.message);
      captured++;
    } catch {
      failed++;
    }
  }

  return {
    status: failed > 0 ? "partial" : "ok",
    rowsProcessed: recs.length,
    metadata: { captured, failed },
  };
}
