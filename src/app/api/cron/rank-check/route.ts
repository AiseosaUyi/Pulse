// Nightly keyword rank check (Serper). For tracked keywords with a target URL,
// query Google (region NG) and record the tenant's position. Budget-capped so
// it stays inside Serper's free monthly quota — oldest-checked keywords first.
// No-ops cleanly when SERPER_API_KEY is unset.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { scrapeViaSerper, isSerperConfigured } from "@/lib/scrape/serper-serp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Hard cap on Serper calls per run to protect the free quota (2,500/mo).
const MAX_QUERIES = 60;

function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      ""
    );
  } catch {
    return url;
  }
}

interface KeywordRow {
  id: string;
  tenant_slug: string;
  keyword: string;
  url: string | null;
  position: number | null;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("rank-check", async () => {
    const summary = {
      configured: isSerperConfigured(),
      checked: 0,
      updated: 0,
      skippedNoUrl: 0,
      failed: 0,
      errors: [] as { keyword: string; message: string }[],
    };
    if (!summary.configured) {
      return { status: "skipped" as const, rowsProcessed: 0, metadata: summary };
    }

    const admin = createAdminClient();

    // Per-tenant search region (settings.seo_region), default 'ng'. Keeps rank
    // checks correct for tenants outside Nigeria as the platform grows.
    const regionByTenant = new Map<string, string>();
    const { data: tenantRows } = await admin
      .from("tenants")
      .select("slug, settings");
    for (const t of (tenantRows ?? []) as { slug: string; settings: Record<string, unknown> | null }[]) {
      const region = (t.settings?.seo_region as string) || "ng";
      regionByTenant.set(t.slug, region.toLowerCase());
    }

    // Oldest-checked first so the budget rotates across all keywords over days.
    const { data } = await admin
      .from("keyword_rankings")
      .select("id, tenant_slug, keyword, url, position")
      .order("last_checked", { ascending: true, nullsFirst: true })
      .limit(MAX_QUERIES);

    for (const row of (data ?? []) as KeywordRow[]) {
      if (!row.url) {
        summary.skippedNoUrl += 1;
        continue;
      }
      const target = domainOf(row.url);
      summary.checked += 1;
      try {
        const results = await scrapeViaSerper({
          query: row.keyword,
          region: regionByTenant.get(row.tenant_slug) ?? "ng",
          limit: 20,
        });
        const hit = results.find((r) => r.domain === target);
        const newPosition = hit?.position ?? null;
        const { error } = await admin
          .from("keyword_rankings")
          .update({
            previous_position: row.position,
            position: newPosition,
            last_checked: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
        summary.updated += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          keyword: row.keyword,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const status =
      summary.failed === 0 ? "ok" : summary.updated > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.updated, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
