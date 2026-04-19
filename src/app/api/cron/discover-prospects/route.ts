// Nightly prospect discovery cron. For each tenant, runs every
// prospect_searches row through the shared runner. Budget-friendly
// on Serper's free tier (2,500 searches/month ≈ 80/day across all
// tenants, plenty of headroom).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { executeProspectSearch } from "@/lib/services/prospect-searches-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface TenantRow {
  slug: string;
  name: string;
}

interface SearchRow {
  id: string;
  tenant_slug: string;
  name: string;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();

  const summary = {
    tenantsProcessed: 0,
    searchesRun: 0,
    inserted: 0,
    qualified: 0,
    skipped: 0,
    failed: 0,
    errors: [] as Array<{
      tenant: string;
      search?: string;
      message: string;
    }>,
  };

  const { data: tenants, error: tenantsErr } = await admin
    .from("tenants")
    .select("slug, name");
  if (tenantsErr || !tenants) {
    return NextResponse.json(
      { error: tenantsErr?.message ?? "Failed to list tenants" },
      { status: 500 }
    );
  }

  for (const tenant of tenants as TenantRow[]) {
    summary.tenantsProcessed += 1;

    const { data: searches, error: searchesErr } = await admin
      .from("prospect_searches")
      .select("id, tenant_slug, name")
      .eq("tenant_slug", tenant.slug);
    if (searchesErr || !searches) continue;

    for (const search of searches as SearchRow[]) {
      summary.searchesRun += 1;
      try {
        const outcome = await executeProspectSearch(tenant.slug, search.id);
        summary.inserted += outcome.insertedCount;
        summary.qualified += outcome.qualifiedCount;
        summary.skipped += outcome.skippedCount;
        if (outcome.errors.length > 0) {
          summary.failed += 1;
          summary.errors.push({
            tenant: tenant.slug,
            search: search.name,
            message: outcome.errors.join("; "),
          });
        }
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          tenant: tenant.slug,
          search: search.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json(summary);
}
