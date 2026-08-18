// Self-hosted event-platform lead-gen cron (Outbound add-on). Sibling to
// /api/cron/scrape-ticketing-platforms, NOT a replacement — that cron and
// its 4 Apify-based platforms are untouched. This one crawls the new
// platforms (Shows.ng, eGotickets, + unconfirmed best-effort ones) with an
// in-house fetcher, no Apify, no proxy by default (see event-fetch.ts).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import {
  ACTIVE_EVENT_PLATFORMS,
  UNCONFIRMED_PLATFORM_IDS,
  IG_MENTION_PLATFORMS,
} from "@/lib/scrape/event-platforms";
import {
  runActiveEventPlatform,
  runUnconfirmedEventPlatform,
  runIgMentionScan,
} from "@/lib/scrape/event-scraper-runner";
import { isEventScraperEnabledForTenant } from "@/lib/scrape/event-platforms/tenant-config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface TenantRow {
  slug: string;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("scrape-event-platforms", async () => {
    const admin = createAdminClient();
    const summary = {
      tenantsProcessed: 0,
      platformsRun: 0,
      candidatesFound: 0,
      prospectsCreated: 0,
      failed: 0,
      errors: [] as { tenant: string; platform: string; message: string }[],
    };

    const { data: tenants, error: tErr } = await admin.from("tenants").select("slug");
    if (tErr || !tenants) throw new Error(tErr?.message ?? "Failed to list tenants");

    for (const tenant of tenants as TenantRow[]) {
      if (!(await isEventScraperEnabledForTenant(tenant.slug))) continue;
      summary.tenantsProcessed += 1;

      for (const config of ACTIVE_EVENT_PLATFORMS) {
        summary.platformsRun += 1;
        try {
          const res = await runActiveEventPlatform(config, {
            tenantSlug: tenant.slug,
            trigger: "cron",
          });
          summary.candidatesFound += res.candidatesFound;
          summary.prospectsCreated += res.prospectsCreated;
        } catch (err) {
          summary.failed += 1;
          summary.errors.push({
            tenant: tenant.slug,
            platform: config.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      for (const platform of UNCONFIRMED_PLATFORM_IDS) {
        summary.platformsRun += 1;
        try {
          const res = await runUnconfirmedEventPlatform(platform, {
            tenantSlug: tenant.slug,
            trigger: "cron",
          });
          summary.candidatesFound += res.candidatesFound;
          summary.prospectsCreated += res.prospectsCreated;
        } catch (err) {
          summary.failed += 1;
          summary.errors.push({
            tenant: tenant.slug,
            platform: platform.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      for (const platform of IG_MENTION_PLATFORMS) {
        summary.platformsRun += 1;
        try {
          const res = await runIgMentionScan(platform.id, platform.label, platform.hashtags, {
            tenantSlug: tenant.slug,
            trigger: "cron",
          });
          summary.candidatesFound += res.candidatesFound;
          summary.prospectsCreated += res.prospectsCreated;
        } catch (err) {
          summary.failed += 1;
          summary.errors.push({
            tenant: tenant.slug,
            platform: platform.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const status =
      summary.failed === 0 ? "ok" : summary.prospectsCreated > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.prospectsCreated, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias per the existing
// scrape-ticketing-platforms convention (GET previously 405ed there).
export const GET = POST;
