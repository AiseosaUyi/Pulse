// Tenant-slug allowlist for the individual-persona content calendar —
// personal dogfood v1, not generalized to the broader individual-persona
// market yet (design doc, locked decision #14). Mirrors the exact same
// pattern as isEventScraperEnabledForTenant. Expand once usage validates
// the mechanism (see TODOS.md "Generalize the content calendar beyond
// the founder's own tenant").

const ENABLED_TENANTS = new Set(["aiseosa-space"]);

export function isContentCalendarEnabledForTenant(tenantSlug: string): boolean {
  return ENABLED_TENANTS.has(tenantSlug);
}
