// Content calendar started as a personal-dogfood-only feature gated to a
// single tenant (design doc, decision #14). That gate is now lifted — the
// feature is available to every tenant, startup or individual persona
// alike (nav-config.ts / SettingsNav.tsx no longer restrict it to
// `surfaces: ["individual"]` either). This function stays as the single
// choke point so a future rollback or re-gating doesn't require touching
// every call site again.

export function isContentCalendarEnabledForTenant(tenantSlug: string): boolean {
  void tenantSlug;
  return true;
}
