// Per-tenant SEO/publishing config. Pulse is multi-tenant (Gruve, Sippy, …) —
// nothing here may hardcode one tenant's domain, region, or taxonomy. Values
// derive from the tenant record (`tenants.settings`: domain + audienceConfig),
// with neutral fallbacks. Gruve is just the first tenant, not a special case.

import { getTenant } from "@/lib/services/tenants";
import type { AudienceConfig } from "@/lib/types/tenant";

export interface TenantSeoConfig {
  /** Public site base URL, e.g. https://www.gruve.events. Null if unset. */
  siteBaseUrl: string | null;
  /** SERP/GSC country code (lowercased), e.g. "ng". Defaults to "us". */
  serpRegion: string;
  /** Route prefix the tenant's frontend renders landing pages at. */
  landingRoutePrefix: string;
  /** Contentful content-type id for programmatic landing pages. */
  landingContentType: string;
}

/** Normalize a stored domain ("gruve.events" or a full URL) to an origin. */
export function siteBaseUrlFromDomain(domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim();
  if (!d) return null;
  const withProto = /^https?:\/\//i.test(d) ? d : `https://${d}`;
  try {
    return new URL(withProto).origin;
  } catch {
    return null;
  }
}

/** First primary region as a lowercased country code; neutral "us" fallback. */
export function serpRegionFromAudience(
  audience: AudienceConfig | null | undefined
): string {
  const first = audience?.primaryRegions?.[0]?.trim().toLowerCase();
  return first || "us";
}

export async function getTenantSeoConfig(
  tenantSlug: string
): Promise<TenantSeoConfig> {
  const tenant = await getTenant(tenantSlug);
  return {
    siteBaseUrl: siteBaseUrlFromDomain(tenant?.domain),
    serpRegion: serpRegionFromAudience(tenant?.audienceConfig),
    // Convention shared with each tenant's frontend; overridable per tenant
    // when a tenant settings field is added. Neutral names (not Gruve-specific).
    landingRoutePrefix: "/discover",
    landingContentType: "seoLandingPage",
  };
}
