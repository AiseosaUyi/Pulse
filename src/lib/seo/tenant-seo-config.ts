// Per-tenant SEO/publishing config. Pulse is multi-tenant (Gruve, Sippy, …) —
// nothing here may hardcode one tenant's domain, region, or taxonomy. Values
// derive from the tenant record (`tenants.settings`: domain + audienceConfig),
// with neutral fallbacks. Gruve is just the first tenant, not a special case.

import { getTenant } from "@/lib/services/tenants";
import type { AudienceConfig } from "@/lib/types/tenant";

// Re-exported for server-side callers that already import from this module —
// the actual implementation lives in the dependency-free `blog-urls.ts` so
// client components can use it without pulling in `getTenant`'s
// `next/headers` dependency chain. See that file for the rationale.
export { buildBlogUrls, type BlogPublicUrls } from "./blog-urls";

export interface TenantSeoConfig {
  /** Public site base URL, e.g. https://sippy.life. Null if unset. */
  siteBaseUrl: string | null;
  /** Staging/preview site base URL, e.g. https://test.sippy.life. Falls back to siteBaseUrl. */
  stagingBaseUrl: string | null;
  /** Route prefix the tenant's blog uses, e.g. "/blog". */
  blogPathPrefix: string;
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

  // Deliberately no tenant === "gruve" special-casing and no shared env-var
  // fallback here (a prior version had both — GRUVE_STAGING_BASE_URL applied
  // to every tenant's staging publish, so Sippy silently inherited Gruve's
  // staging host, or fell through to its own *live* domain when unset).
  // `domain` / `stagingDomain` live entirely in tenant.settings, editable at
  // Settings → Integrations → Site domains (src/lib/actions/site-domains.ts).
  // When stagingDomain is unset, staging correctly has nowhere safe to point
  // and falls back to the live domain rather than silently resolving to some
  // other tenant's staging host.
  const siteBaseUrl = siteBaseUrlFromDomain(tenant?.domain);
  const stagingBaseUrl =
    siteBaseUrlFromDomain(tenant?.stagingDomain) ?? siteBaseUrl;

  return {
    siteBaseUrl,
    stagingBaseUrl,
    blogPathPrefix: tenant?.blogPathPrefix || "/blog",
    serpRegion: serpRegionFromAudience(tenant?.audienceConfig),
    landingRoutePrefix: "/discover",
    landingContentType: "seoLandingPage",
  };
}
