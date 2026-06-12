// Real ranking sync (PULSE-SEO-SPEC §15-adjacent / W1). Two sources:
//
//   1. Google Search Console — canonical impressions/clicks/CTR/position per
//      query for pages we already rank for. Upserts gsc_query_daily and
//      auto-fills keyword_rankings.position (source 'gsc').
//   2. Serper rank-check — for tracked keywords GSC has no row for (i.e. not
//      yet ranking, or below the GSC sampling floor), look up gruve.events'
//      position in the live SERP (source 'serper').
//
// Manual positions (source 'manual', set when an editor uses the pencil) are
// never clobbered — the user override wins.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGscQueryDaily } from "@/lib/integrations/search-console";
import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";
import { serpRegionFromAudience } from "@/lib/seo/tenant-seo-config";
import type { AudienceConfig } from "@/lib/types/tenant";

const SERPER_RANK_CHECK_CAP = 25; // bound Serper spend per run

function normalizeKeyword(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function bareDomain(siteUrl: string): string {
  return siteUrl
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

interface GscTenant {
  tenant_slug: string;
  site_url: string;
  service_account_json: string;
  region: string;
}

export async function syncSearchConsole(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const admin = createAdminClient();

  const { data: integrations } = await admin
    .from("tenant_integrations")
    .select("tenant_slug, config, secret_token")
    .eq("provider", "gsc")
    .eq("status", "connected");

  // Per-tenant SERP region from the tenant record (admin context — no RLS
  // session in cron, so read settings directly here rather than via getTenant).
  const slugs = Array.from(
    new Set((integrations ?? []).map((r) => r.tenant_slug as string))
  );
  const regionBySlug = new Map<string, string>();
  if (slugs.length > 0) {
    const { data: tenantRows } = await admin
      .from("tenants")
      .select("slug, settings")
      .in("slug", slugs);
    for (const t of tenantRows ?? []) {
      const audience = (t.settings as { audienceConfig?: AudienceConfig } | null)
        ?.audienceConfig;
      regionBySlug.set(t.slug as string, serpRegionFromAudience(audience));
    }
  }

  const tenants: GscTenant[] = (integrations ?? [])
    .map((r) => ({
      tenant_slug: r.tenant_slug as string,
      site_url: String((r.config as Record<string, unknown>)?.site_url ?? ""),
      service_account_json: (r.secret_token as string) ?? "",
      region: regionBySlug.get(r.tenant_slug as string) ?? "us",
    }))
    .filter((t) => t.site_url && t.service_account_json);

  let upserted = 0;
  let keywordsFilled = 0;
  let serperChecked = 0;
  let failed = 0;

  // Pull a short trailing window — GSC data lags ~2-3 days.
  const to = new Date();
  const from = new Date(to.getTime() - 5 * 86_400_000);
  const startDate = from.toISOString().slice(0, 10);
  const endDate = to.toISOString().slice(0, 10);

  for (const t of tenants) {
    try {
      const rows = await fetchGscQueryDaily({
        siteUrl: t.site_url,
        serviceAccountJson: t.service_account_json,
        startDate,
        endDate,
      });

      if (rows.length > 0) {
        const { error: upErr } = await admin.from("gsc_query_daily").upsert(
          rows.map((r) => ({
            tenant_slug: t.tenant_slug,
            query: r.query,
            page: r.page,
            date: r.date,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
          { onConflict: "tenant_slug,query,page,date" }
        );
        if (upErr) throw new Error(upErr.message);
        upserted += rows.length;
      }

      // Best (lowest) average position per normalized query in this window.
      const bestByQuery = new Map<string, number>();
      for (const r of rows) {
        const k = normalizeKeyword(r.query);
        const prev = bestByQuery.get(k);
        if (prev == null || r.position < prev) bestByQuery.set(k, r.position);
      }

      // Auto-fill tracked keyword positions (skip manual overrides).
      const { data: keywords } = await admin
        .from("keyword_rankings")
        .select("id, keyword, position, position_source")
        .eq("tenant_slug", t.tenant_slug);

      const today = endDate;
      const unmatched: { id: string; keyword: string }[] = [];

      for (const kw of keywords ?? []) {
        if (kw.position_source === "manual") continue;
        const hit = bestByQuery.get(normalizeKeyword(kw.keyword));
        if (hit != null) {
          const rounded = Math.round(hit);
          await admin
            .from("keyword_rankings")
            .update({
              previous_position: kw.position ?? null,
              position: rounded,
              position_source: "gsc",
              last_checked: today,
            })
            .eq("id", kw.id);
          keywordsFilled++;
        } else {
          unmatched.push({ id: kw.id, keyword: kw.keyword });
        }
      }

      // Serper rank-check for keywords GSC didn't cover (bounded).
      const domain = bareDomain(t.site_url);
      for (const kw of unmatched.slice(0, SERPER_RANK_CHECK_CAP)) {
        try {
          const results = await scrapeGoogleSerp({
            query: kw.keyword,
            region: t.region,
            limit: 20,
          });
          serperChecked++;
          const match = results.find(
            (r) => r.domain.includes(domain) || r.url.includes(domain)
          );
          await admin
            .from("keyword_rankings")
            .update({
              position: match ? match.position : null,
              position_source: "serper",
              last_checked: today,
            })
            .eq("id", kw.id)
            .not("position_source", "eq", "manual");
          if (match) keywordsFilled++;
        } catch {
          /* skip this keyword; continue the batch */
        }
      }
    } catch {
      failed++;
    }
  }

  return {
    status: failed > 0 ? "partial" : "ok",
    rowsProcessed: upserted,
    metadata: {
      tenants: tenants.length,
      upserted,
      keywordsFilled,
      serperChecked,
      failed,
    },
  };
}
