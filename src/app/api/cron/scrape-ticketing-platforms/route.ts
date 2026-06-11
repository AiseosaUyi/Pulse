// Platform-discovery lead-gen cron (formerly Gruve-only ticketing scraper).
// Now per-tenant: every tenant with a discovery config (tenants.settings
// .discovery) mines its own platforms. Gruve falls back to its built-in
// ticketing sources, so its behavior is unchanged. Sippy (or any tenant) can
// configure drinks platforms, marketplaces, etc. The backlog cron AI-qualifies
// the newly-flagged rows (qualify_pending: true).
//
// Route path kept as /scrape-ticketing-platforms for vercel.json continuity.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { getDiscoveryConfig } from "@/lib/scrape/discovery-config";
import {
  crawlSources,
  aggregateByHandle,
  enrichHandlesWithIg,
  scoreListingActivity,
} from "@/lib/scrape/platform-discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface TenantRow {
  slug: string;
  name: string;
  settings: Record<string, unknown> | null;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("scrape-ticketing-platforms", async () => {
    const admin = createAdminClient();
    const summary = {
      tenantsProcessed: 0,
      tenantsConfigured: 0,
      scraped: 0,
      withHandle: 0,
      upserted: 0,
      failed: 0,
      errors: [] as { tenant: string; message: string }[],
    };

    const { data: tenants, error: tErr } = await admin
      .from("tenants")
      .select("slug, name, settings");
    if (tErr || !tenants) {
      throw new Error(tErr?.message ?? "Failed to list tenants");
    }

    for (const tenant of tenants as TenantRow[]) {
      summary.tenantsProcessed += 1;
      const config = getDiscoveryConfig(tenant);
      if (!config) continue;
      summary.tenantsConfigured += 1;

      try {
        // Ensure a permanent prospect_searches record exists for this signal.
        const { data: existing } = await admin
          .from("prospect_searches")
          .select("id")
          .eq("tenant_slug", tenant.slug)
          .eq("signal_type", config.signalType)
          .maybeSingle();

        let searchId = (existing as { id: string } | null)?.id;
        if (!searchId) {
          const { data: created, error: cErr } = await admin
            .from("prospect_searches")
            .insert({
              tenant_slug: tenant.slug,
              name: "Platform Auto-Discovery",
              platform: "instagram",
              signal_type: config.signalType,
              query: "all",
              filters: {},
              auto_qualify: false,
            })
            .select("id")
            .single();
          if (cErr || !created) {
            throw new Error(cErr?.message ?? "Failed to create search record");
          }
          searchId = created.id as string;
        }

        let candidates = await crawlSources(config.sources, config.limitPerSource);
        summary.scraped += candidates.length;
        if (candidates.length > config.maxCandidates) {
          candidates = candidates
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, config.maxCandidates);
        }

        const handles = aggregateByHandle(candidates);
        summary.withHandle += handles.size;
        if (handles.size === 0) continue;

        const igProfiles = await enrichHandlesWithIg([...handles.keys()]);

        const rows = [...handles.entries()].map(([handle, agg]) => {
          const profile = igProfiles.get(handle);
          const { tier, timing, priorityScore } = scoreListingActivity({
            count90d: agg.count90d,
            count365d: agg.count365d,
            lastDateIso: agg.lastDate,
          });
          return {
            tenant_slug: tenant.slug,
            search_id: searchId,
            platform: "instagram",
            handle,
            display_name: profile?.fullName ?? null,
            profile_url: agg.igProfileUrl,
            avatar_url: profile?.profilePicUrl ?? null,
            bio: profile?.biography ?? null,
            follower_count: profile?.followersCount ?? null,
            signal_summary: `[${config.signalType}] ${tier} · ${agg.count90d} listings/90d · last ${agg.lastDate}`,
            signal_data: {
              source_type: config.signalType,
              platform_sources: agg.sources,
              activity_tier: tier,
              listings_90d: agg.count90d,
              listings_365d: agg.count365d,
              last_listing_date: agg.lastDate,
              reach_out_timing: timing,
              priority_score: priorityScore,
              qualify_pending: true,
            },
            status: "new",
          };
        });

        const { data: upserted, error: upErr } = await admin
          .from("prospects")
          .upsert(rows, { onConflict: "tenant_slug,platform,handle" })
          .select("id");
        if (upErr) throw new Error(upErr.message);
        summary.upserted += upserted?.length ?? 0;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          tenant: tenant.slug,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const status =
      summary.failed === 0 ? "ok" : summary.upserted > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.upserted, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
