// Meta Ad Library API — public ad transparency data, used here for
// competitor ad intelligence. Distinct, lighter-weight auth than the full
// Marketing API: a verified-developer-account access token is sufficient,
// no ads_management/Business Verification/App Review gate (that gate is
// specific to managing real ad accounts, not reading public ad data).
//
// Real scope limitation, worth stating plainly rather than overselling:
// exact spend/impression *numbers* are only populated for political/
// social-issue ads and EU-regulated ads. For an ordinary commercial
// competitor (Sippy's actual competitor set — none political, none
// EU-facing), this API still returns real value: which ads are running,
// the actual creative (via ad_snapshot_url), which platforms, and delivery
// dates — enough to build the two signals that matter most in this space:
// ad LONGEVITY as a profitability proxy, and VARIANT COUNT as a proxy for
// how aggressively a competitor is testing. It will not return a spend
// figure for these ads — don't build UI that implies it will.
//
// TikTok has no equivalent open API — its only programmatic ad-transparency
// surface (the Commercial Content Library) is EU-region-only and
// research-access-gated, which doesn't serve a Nigeria-based tenant like
// Sippy. Deliberately not built here; see PULSE-ADS-SPEC for the reasoning
// if TikTok competitor intel becomes worth revisiting for an EU tenant.

const GRAPH_VERSION = "v25.0";
const AD_LIBRARY_URL = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`;

export function isMetaAdLibraryConfigured(): boolean {
  return !!process.env.META_AD_LIBRARY_ACCESS_TOKEN;
}

export interface MetaAdLibraryAd {
  id: string;
  pageName: string | null;
  adSnapshotUrl: string | null;
  creativeBody: string | null;
  deliveryStartTime: string | null;
  deliveryStopTime: string | null;
  isActive: boolean;
  publisherPlatforms: string[];
  currency: string | null;
  /** Only populated for SIEP/EU-scoped ads — see file header. */
  spendRange: { lower: number; upper: number | null } | null;
  impressionsRange: { lower: number; upper: number | null } | null;
}

interface RawAdLibraryRow {
  id: string;
  page_name?: string;
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  currency?: string;
  spend?: { lower_bound?: string; upper_bound?: string };
  impressions?: { lower_bound?: string; upper_bound?: string };
}

/** `searchTerms` — page/brand name to search for. `countries` — ISO codes,
 *  required by the API (e.g. ['NG']). `activeOnly` restricts to
 *  currently-running ads, the more actionable case for "what are they
 *  running right now." */
export async function searchMetaAdLibrary(
  searchTerms: string,
  countries: string[],
  activeOnly = true
): Promise<MetaAdLibraryAd[]> {
  const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  if (!token) throw new Error("META_AD_LIBRARY_ACCESS_TOKEN is not set");

  const params = new URLSearchParams({
    access_token: token,
    search_terms: searchTerms,
    ad_reached_countries: JSON.stringify(countries),
    ad_type: "ALL",
    ad_active_status: activeOnly ? "ACTIVE" : "ALL",
    fields: [
      "id",
      "page_name",
      "ad_snapshot_url",
      "ad_creative_bodies",
      "ad_delivery_start_time",
      "ad_delivery_stop_time",
      "publisher_platforms",
      "currency",
      "spend",
      "impressions",
    ].join(","),
    limit: "100",
  });

  const res = await fetch(`${AD_LIBRARY_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`Meta Ad Library search failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: RawAdLibraryRow[] };

  return (json.data ?? []).map((r) => ({
    id: r.id,
    pageName: r.page_name ?? null,
    adSnapshotUrl: r.ad_snapshot_url ?? null,
    creativeBody: r.ad_creative_bodies?.[0] ?? null,
    deliveryStartTime: r.ad_delivery_start_time ?? null,
    deliveryStopTime: r.ad_delivery_stop_time ?? null,
    isActive: !r.ad_delivery_stop_time,
    publisherPlatforms: r.publisher_platforms ?? [],
    currency: r.currency ?? null,
    spendRange: r.spend?.lower_bound
      ? { lower: Number(r.spend.lower_bound), upper: r.spend.upper_bound ? Number(r.spend.upper_bound) : null }
      : null,
    impressionsRange: r.impressions?.lower_bound
      ? { lower: Number(r.impressions.lower_bound), upper: r.impressions.upper_bound ? Number(r.impressions.upper_bound) : null }
      : null,
  }));
}

/** Cheap near-duplicate grouping — normalizes the creative body text
 *  (lowercase, strip punctuation/whitespace, first 80 chars) so multiple
 *  variants of the same underlying concept land in the same group. Good
 *  enough for "how many versions of this is the competitor running" — not
 *  meant to be a precise clustering algorithm. */
export function creativeVariantGroupKey(pageName: string | null, creativeBody: string | null): string {
  const normalized = (creativeBody ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${(pageName ?? "unknown").toLowerCase()}::${normalized}`;
}
