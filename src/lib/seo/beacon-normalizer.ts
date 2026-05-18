// Beacon normalizer (PULSE-SEO-SPEC.md §14, wire contract C4 — now
// fixed). Claims unprocessed seo_webhook_events (source 'gruve-beacon'),
// parses the C4 envelope, resolves each event's `slug` → blog_posts
// (tenant), and accumulates per-(tenant,slug,date) into
// seo_post_engagement_daily. Idempotent at event-row granularity:
// every row is stamped processed_at exactly once.
//
// C4 envelope:
//   { receivedAt, ipTrunc, country, ua,
//     events: [{ name, occurredAt, sessionId, slug?, payload }] }
// Event names (fixed): blog_view · blog_scroll{depth} ·
//   blog_dwell{msActive} · blog_outbound · blog_internal_link ·
//   blog_share · blog_cta_click · web_vitals (not rolled up).

import { createAdminClient } from "@/lib/supabase/admin";

interface BeaconEvent {
  name: string;
  occurredAt: string;
  sessionId: string;
  slug?: string;
  payload?: Record<string, unknown>;
}

interface Acc {
  views: number;
  dwell_ms_total: number;
  scroll_depth_sum: number;
  outbound_clicks: number;
  internal_clicks: number;
  shares: number;
  cta_clicks: number;
}
const zero = (): Acc => ({
  views: 0,
  dwell_ms_total: 0,
  scroll_depth_sum: 0,
  outbound_clicks: 0,
  internal_clicks: 0,
  shares: 0,
  cta_clicks: 0,
});

function utcDate(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function fold(acc: Acc, ev: BeaconEvent): void {
  const pl = ev.payload ?? {};
  switch (ev.name) {
    case "blog_view":
      acc.views += 1;
      break;
    case "blog_dwell":
      acc.dwell_ms_total += Number(pl.msActive ?? 0) || 0;
      break;
    case "blog_scroll":
      acc.scroll_depth_sum += Number(pl.depth ?? 0) || 0;
      break;
    case "blog_outbound":
      acc.outbound_clicks += 1;
      break;
    case "blog_internal_link":
      acc.internal_clicks += 1;
      break;
    case "blog_share":
      acc.shares += 1;
      break;
    case "blog_cta_click":
      acc.cta_clicks += 1;
      break;
    // web_vitals: kept raw in seo_webhook_events, not rolled up.
  }
}

export async function processUnprocessedBeacons(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("seo_webhook_events")
    .select("id, payload")
    .eq("source", "gruve-beacon")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(200);

  const list = rows ?? [];
  if (list.length === 0) {
    return { status: "ok", rowsProcessed: 0, metadata: { batches: 0 } };
  }

  // slug → tenant_slug (null = no matching post). Cached across batches.
  const tenantBySlug = new Map<string, string | null>();
  const resolveTenant = async (slug: string): Promise<string | null> => {
    if (tenantBySlug.has(slug)) return tenantBySlug.get(slug)!;
    const { data } = await supabase
      .from("blog_posts")
      .select("tenant_slug")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();
    const t = data?.tenant_slug ?? null;
    tenantBySlug.set(slug, t);
    return t;
  };

  // (tenant|slug|date) → Acc
  const agg = new Map<string, Acc>();
  let events = 0;
  let unmatched = 0;

  for (const row of list) {
    const env = (row.payload ?? {}) as { events?: BeaconEvent[] };
    for (const ev of env.events ?? []) {
      events++;
      if (!ev?.slug || !ev.occurredAt) {
        unmatched++;
        continue;
      }
      const tenant = await resolveTenant(ev.slug);
      const date = utcDate(ev.occurredAt);
      if (!tenant || !date) {
        unmatched++;
        continue;
      }
      const key = `${tenant}|${ev.slug}|${date}`;
      const acc = agg.get(key) ?? zero();
      fold(acc, ev);
      agg.set(key, acc);
    }
  }

  // Upsert accumulations (read-modify-write; safe because each beacon
  // row is processed exactly once via processed_at).
  for (const [key, acc] of agg) {
    const [tenant_slug, slug, date] = key.split("|");
    const { data: existing } = await supabase
      .from("seo_post_engagement_daily")
      .select(
        "views, dwell_ms_total, scroll_depth_sum, outbound_clicks, internal_clicks, shares, cta_clicks"
      )
      .eq("tenant_slug", tenant_slug)
      .eq("slug", slug)
      .eq("date", date)
      .maybeSingle();
    const base = existing ?? zero();
    await supabase.from("seo_post_engagement_daily").upsert(
      {
        tenant_slug,
        slug,
        date,
        views: base.views + acc.views,
        dwell_ms_total: Number(base.dwell_ms_total) + acc.dwell_ms_total,
        scroll_depth_sum: base.scroll_depth_sum + acc.scroll_depth_sum,
        outbound_clicks: base.outbound_clicks + acc.outbound_clicks,
        internal_clicks: base.internal_clicks + acc.internal_clicks,
        shares: base.shares + acc.shares,
        cta_clicks: base.cta_clicks + acc.cta_clicks,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_slug,slug,date" }
    );
  }

  // Stamp every claimed row processed.
  const ids = list.map((r) => r.id);
  await supabase
    .from("seo_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .in("id", ids);

  return {
    status: unmatched > 0 ? "partial" : "ok",
    rowsProcessed: list.length,
    metadata: {
      batches: list.length,
      events,
      unmatched,
      slugsRolledUp: agg.size,
    },
  };
}
