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

  for (const p of list) {
    try {
      const extras = scoreSeoExtras({
        seoMetaTitle: p.seo_meta_title ?? null,
        seoMetaDescription: p.seo_meta_description ?? null,
        bodyMarkdown: typeof p.content === "string" ? p.content : "",
        jsonLdBlocks: Array.isArray(p.json_ld_blocks) ? p.json_ld_blocks : [],
        serpAvgWordCount: null,
        serpTopDomains: [],
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
