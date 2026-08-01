import { createAdminClient } from "@/lib/supabase/admin";
import type { CompetitorAdRecord, AdPlatformKind } from "@/lib/types/ads-platform";

function rowTo(r: Record<string, unknown>): CompetitorAdRecord {
  return {
    id: r.id as string,
    tenantSlug: r.tenant_slug as string,
    competitorId: (r.competitor_id as string) ?? null,
    platform: r.platform as AdPlatformKind,
    externalAdId: r.external_ad_id as string,
    pageOrAccountName: (r.page_or_account_name as string) ?? null,
    snapshotUrl: (r.snapshot_url as string) ?? null,
    creativeBody: (r.creative_body as string) ?? null,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
    stillActive: r.still_active as boolean,
    platformsDelivered: (r.platforms_delivered as string[]) ?? [],
    variantGroupKey: (r.variant_group_key as string) ?? null,
  };
}

export async function upsertCompetitorAd(params: {
  tenantSlug: string;
  competitorId: string | null;
  platform: AdPlatformKind;
  externalAdId: string;
  pageOrAccountName: string | null;
  snapshotUrl: string | null;
  creativeBody: string | null;
  stillActive: boolean;
  platformsDelivered: string[];
  variantGroupKey: string | null;
  raw: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  // Preserve first_seen_at across re-syncs of an already-tracked ad —
  // longevity (how long an ad has run) is the whole point of tracking it.
  const { data: existing } = await admin
    .from("competitor_ads")
    .select("id, first_seen_at")
    .eq("tenant_slug", params.tenantSlug)
    .eq("platform", params.platform)
    .eq("external_ad_id", params.externalAdId)
    .maybeSingle();

  const { error } = await admin.from("competitor_ads").upsert(
    {
      tenant_slug: params.tenantSlug,
      competitor_id: params.competitorId,
      platform: params.platform,
      external_ad_id: params.externalAdId,
      page_or_account_name: params.pageOrAccountName,
      snapshot_url: params.snapshotUrl,
      creative_body: params.creativeBody,
      first_seen_at: existing?.first_seen_at ?? new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      still_active: params.stillActive,
      platforms_delivered: params.platformsDelivered,
      variant_group_key: params.variantGroupKey,
      raw: params.raw,
    },
    { onConflict: "tenant_slug,platform,external_ad_id" }
  );
  if (error) throw new Error(`upsertCompetitorAd: ${error.message}`);
}

/** Ads not seen in the latest sync pass are presumed no longer running —
 *  called once per competitor after all its current ads have been
 *  upserted, so anything with a stale last_seen_at flips to inactive
 *  rather than lingering as a false "still active" forever. */
export async function markStaleCompetitorAdsInactive(
  tenantSlug: string,
  competitorId: string,
  syncStartedAt: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("competitor_ads")
    .update({ still_active: false })
    .eq("tenant_slug", tenantSlug)
    .eq("competitor_id", competitorId)
    .eq("still_active", true)
    .lt("last_seen_at", syncStartedAt);
}

export async function listCompetitorAds(
  tenantSlug: string,
  opts: { activeOnly?: boolean; competitorId?: string; limit?: number } = {}
): Promise<CompetitorAdRecord[]> {
  const admin = createAdminClient();
  let query = admin
    .from("competitor_ads")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("first_seen_at", { ascending: true }) // longest-running first — the actionable signal
    .limit(opts.limit ?? 100);
  if (opts.activeOnly) query = query.eq("still_active", true);
  if (opts.competitorId) query = query.eq("competitor_id", opts.competitorId);
  const { data } = await query;
  return (data ?? []).map(rowTo);
}

/** Variant counts per group — "this competitor is running N versions of
 *  this concept," the signal that matters more than any single ad's copy. */
export async function getCompetitorVariantCounts(
  tenantSlug: string,
  competitorId: string
): Promise<Array<{ variantGroupKey: string; count: number; sampleAdId: string }>> {
  const ads = await listCompetitorAds(tenantSlug, { competitorId, activeOnly: true, limit: 500 });
  const groups = new Map<string, { count: number; sampleAdId: string }>();
  for (const ad of ads) {
    if (!ad.variantGroupKey) continue;
    const prev = groups.get(ad.variantGroupKey) ?? { count: 0, sampleAdId: ad.id };
    prev.count += 1;
    groups.set(ad.variantGroupKey, prev);
  }
  return [...groups.entries()]
    .map(([variantGroupKey, v]) => ({ variantGroupKey, ...v }))
    .sort((a, b) => b.count - a.count);
}
