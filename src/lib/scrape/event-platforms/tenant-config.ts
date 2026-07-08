// Which tenants run the new self-hosted event-platform scraper. Kept
// separate from discovery-config.ts (the Apify-based system) on purpose —
// the design doc's explicit constraint is that the old 4 platforms and
// their config stay untouched. Defaults to Gruve only, same bootstrapping
// convention as GRUVE_TICKETING_DEFAULT.

const ENABLED_TENANTS = new Set(["gruve"]);

export function isEventScraperEnabledForTenant(tenantSlug: string): boolean {
  return ENABLED_TENANTS.has(tenantSlug);
}
