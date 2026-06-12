// Recommendation generator (PULSE-SEO-SPEC.md §9). Baseline derived
// from the ALREADY-SHIPPED deterministic scorer (score-seo-extras.ts) —
// NOT invented rubrics. Maps non-passing gauges on published posts to
// surfaced seo_recommendations rows.
//
// Covered (deterministic, real today): meta_rewrite, content_refresh,
// internal_link_add, schema_add, faq_add.
// [SPEC-PENDING] keyword_capture / backlink_outreach (need SERP + AI
// scoring) and decay_alert (needs metric time-series) — gated until the
// original spec §13–§16 rubrics arrive. They are intentionally NOT
// emitted rather than guessed.
//
// Dedup: at most one *surfaced* rec of a given type per post (coarser
// than 045's payload-hash unique index, but spam-safe and stable).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  scoreSeoExtras,
  type GaugeStatus,
} from "@/lib/ai/seo/score-seo-extras";

type RecType =
  | "meta_rewrite"
  | "content_refresh"
  | "internal_link_add"
  | "schema_add"
  | "faq_add";

const CONFIDENCE: Record<Exclude<GaugeStatus, "good" | "skipped">, number> = {
  bad: 0.85,
  warn: 0.55,
};

function conf(s: GaugeStatus): number | null {
  return s === "bad" || s === "warn" ? CONFIDENCE[s] : null;
}

export async function generateRecommendations(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const supabase = createAdminClient();

  const { data: posts } = await supabase
    .from("blog_posts")
    .select(
      "id, tenant_slug, slug, seo_meta_title, seo_meta_description, content, json_ld_blocks, faq_items"
    )
    .eq("status", "published")
    .limit(500);

  const list = posts ?? [];
  let created = 0;
  let failed = 0;

  // Per-tenant site domain (for internal-vs-external link grading) — read
  // once via admin since this is a cron with no RLS session.
  const slugs = Array.from(new Set(list.map((p) => p.tenant_slug as string)));
  const domainBySlug = new Map<string, string | null>();
  if (slugs.length > 0) {
    const { data: tenantRows } = await supabase
      .from("tenants")
      .select("slug, settings")
      .in("slug", slugs);
    for (const t of tenantRows ?? []) {
      const domain = (t.settings as { domain?: string } | null)?.domain ?? null;
      domainBySlug.set(t.slug as string, domain);
    }
  }

  for (const p of list) {
    try {
      const extras = scoreSeoExtras({
        seoMetaTitle: p.seo_meta_title ?? null,
        seoMetaDescription: p.seo_meta_description ?? null,
        bodyMarkdown: typeof p.content === "string" ? p.content : "",
        jsonLdBlocks: Array.isArray(p.json_ld_blocks) ? p.json_ld_blocks : [],
        serpAvgWordCount: null,
        serpTopDomains: [],
        siteDomain: domainBySlug.get(p.tenant_slug) ?? null,
      });

      // Map gauges → candidate recs.
      const candidates: { type: RecType; score: number; payload: object }[] =
        [];
      const push = (
        type: RecType,
        status: GaugeStatus,
        reason: string
      ) => {
        const c = conf(status);
        if (c != null) candidates.push({ type, score: c, payload: { reason } });
      };

      if (extras.metaTitle.status !== "good")
        push("meta_rewrite", extras.metaTitle.status, extras.metaTitle.label);
      if (extras.metaDescription.status !== "good")
        push(
          "meta_rewrite",
          extras.metaDescription.status,
          extras.metaDescription.label
        );
      if (extras.lengthVsSerp.status === "bad")
        push("content_refresh", "bad", extras.lengthVsSerp.label);
      if (extras.internalLinks.status !== "good")
        push(
          "internal_link_add",
          extras.internalLinks.status,
          extras.internalLinks.label
        );
      if (extras.jsonLd.status === "bad")
        push("schema_add", "bad", extras.jsonLd.label);

      const faqEmpty =
        !p.faq_items ||
        (Array.isArray(p.faq_items) && p.faq_items.length === 0);
      if (faqEmpty)
        push("faq_add", "warn", "No FAQ block — eligible for FAQ schema");

      if (candidates.length === 0) continue;

      // Skip types already surfaced for this post.
      const { data: existing } = await supabase
        .from("seo_recommendations")
        .select("type")
        .eq("blog_post_id", p.id)
        .eq("status", "surfaced");
      const seen = new Set((existing ?? []).map((r) => r.type));

      // One per type (highest score wins if duplicated, e.g. meta_rewrite).
      const byType = new Map<RecType, { score: number; payload: object }>();
      for (const c of candidates) {
        if (seen.has(c.type)) continue;
        const prev = byType.get(c.type);
        if (!prev || c.score > prev.score)
          byType.set(c.type, { score: c.score, payload: c.payload });
      }
      if (byType.size === 0) continue;

      const rows = [...byType.entries()].map(([type, v]) => ({
        tenant_slug: p.tenant_slug,
        blog_post_id: p.id,
        slug: p.slug ?? null,
        type,
        payload: v.payload,
        score: v.score,
        status: "surfaced",
      }));
      const { error } = await supabase
        .from("seo_recommendations")
        .insert(rows);
      if (error) throw new Error(error.message);
      created += rows.length;
    } catch {
      failed++;
    }
  }

  return {
    status: failed > 0 ? "partial" : "ok",
    rowsProcessed: list.length,
    metadata: { created, failed },
  };
}

// keyword_capture (unblocked by W1's GSC connector). A "striking-distance"
// page ranks on page 1-2 (avg position 8-20) with real impressions but is
// leaking clicks — a small on-page push can capture them. We surface one rec
// per (post, query) pointing at the page to improve.
const STRIKING_MIN_POS = 8;
const STRIKING_MAX_POS = 20;
const STRIKING_MIN_IMPRESSIONS = 30;

function slugFromPage(page: string): string | null {
  try {
    const path = new URL(page).pathname.replace(/\/$/, "");
    const seg = path.split("/").filter(Boolean).pop();
    return seg ?? null;
  } catch {
    return null;
  }
}

export async function generateKeywordCaptureRecs(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const supabase = createAdminClient();

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data: rows } = await supabase
    .from("gsc_query_daily")
    .select("tenant_slug, query, page, impressions, clicks, position, date")
    .gte("date", since)
    .limit(5000);

  // Aggregate per (tenant, query, page): mean position, summed impressions.
  type Agg = {
    tenant: string;
    query: string;
    page: string;
    impressions: number;
    clicks: number;
    posSum: number;
    n: number;
  };
  const agg = new Map<string, Agg>();
  for (const r of rows ?? []) {
    const key = `${r.tenant_slug}|${r.query}|${r.page}`;
    const a =
      agg.get(key) ??
      {
        tenant: r.tenant_slug,
        query: r.query,
        page: r.page,
        impressions: 0,
        clicks: 0,
        posSum: 0,
        n: 0,
      };
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.posSum += Number(r.position ?? 0);
    a.n += 1;
    agg.set(key, a);
  }

  let created = 0;
  let scanned = 0;

  for (const a of agg.values()) {
    const avgPos = a.n ? a.posSum / a.n : 0;
    if (
      avgPos < STRIKING_MIN_POS ||
      avgPos > STRIKING_MAX_POS ||
      a.impressions < STRIKING_MIN_IMPRESSIONS
    ) {
      continue;
    }
    scanned++;

    const slug = slugFromPage(a.page);
    if (!slug) continue;

    const { data: post } = await supabase
      .from("blog_posts")
      .select("id")
      .eq("tenant_slug", a.tenant)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (!post) continue;

    // Dedup: one surfaced keyword_capture per (post, query).
    const { data: existing } = await supabase
      .from("seo_recommendations")
      .select("id, payload")
      .eq("blog_post_id", post.id)
      .eq("type", "keyword_capture")
      .eq("status", "surfaced");
    const already = (existing ?? []).some(
      (e) => (e.payload as { query?: string })?.query === a.query
    );
    if (already) continue;

    const { error } = await supabase.from("seo_recommendations").insert({
      tenant_slug: a.tenant,
      blog_post_id: post.id,
      slug,
      type: "keyword_capture",
      payload: {
        source: "gsc",
        query: a.query,
        page: a.page,
        avg_position: Number(avgPos.toFixed(1)),
        impressions: a.impressions,
        clicks: a.clicks,
        reason: `Ranks ~#${Math.round(avgPos)} for "${a.query}" with ${a.impressions} impressions — striking distance. Tighten on-page targeting to capture the clicks.`,
      },
      score: 0.8,
      status: "surfaced",
    });
    if (!error) created++;
  }

  return {
    status: "ok",
    rowsProcessed: scanned,
    metadata: { created, candidates: agg.size },
  };
}
