// Daily cron: for every tenant's tracked competitors (the existing
// `competitors` table — Intel Feed's competitor list, not ad-specific),
// search Meta's Ad Library for that competitor's active ads and upsert
// into competitor_ads. See src/lib/integrations/meta-ad-library.ts for the
// real scope of what this API returns for ordinary commercial advertisers.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isMetaAdLibraryConfigured,
  searchMetaAdLibrary,
  creativeVariantGroupKey,
} from "@/lib/integrations/meta-ad-library";
import { upsertCompetitorAd, markStaleCompetitorAdsInactive } from "@/lib/services/competitor-ads";

export const maxDuration = 300;

// TODO: derive per-tenant from a real country setting once one exists
// (tenants.settings.audienceConfig currently stores city names, e.g.
// "Lagos"/"Abuja", not ISO country codes — see tenant-seo-config.ts's
// serpRegionFromAudience for the same gap in the SEO module). Hardcoding
// NG here is honest about matching Pulse's only two currently-real
// tenants (Gruve, Sippy), not a generalized solution.
const DEFAULT_COUNTRY = "NG";

interface CompetitorRow {
  id: string;
  tenant_id: string;
  name: string;
}

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMetaAdLibraryConfigured()) {
    return Response.json({ skipped: true, reason: "META_AD_LIBRARY_ACCESS_TOKEN not set" });
  }

  const admin = createAdminClient();
  const { data: competitors, error } = await admin
    .from("competitors")
    .select("id, tenant_id, name");
  if (error || !competitors) {
    return Response.json({ error: error?.message ?? "Query failed" }, { status: 500 });
  }

  let synced = 0;
  let errors = 0;
  const syncStartedAt = new Date().toISOString();

  for (const c of competitors as CompetitorRow[]) {
    try {
      const ads = await searchMetaAdLibrary(c.name, [DEFAULT_COUNTRY], true);
      for (const ad of ads) {
        await upsertCompetitorAd({
          tenantSlug: c.tenant_id,
          competitorId: c.id,
          platform: "meta",
          externalAdId: ad.id,
          pageOrAccountName: ad.pageName,
          snapshotUrl: ad.adSnapshotUrl,
          creativeBody: ad.creativeBody,
          stillActive: ad.isActive,
          platformsDelivered: ad.publisherPlatforms,
          variantGroupKey: creativeVariantGroupKey(ad.pageName, ad.creativeBody),
          raw: ad as unknown as Record<string, unknown>,
        });
      }
      await markStaleCompetitorAdsInactive(c.tenant_id, c.id, syncStartedAt);
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[sync-competitor-ads] failed for competitor", c.id, msg);
      errors++;
    }
  }

  return Response.json({ synced, errors, total: competitors.length });
}
