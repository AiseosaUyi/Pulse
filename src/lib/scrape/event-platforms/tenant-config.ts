// Per-tenant opt-out for the self-hosted event-platform scraper. Defaults to
// ENABLED for every tenant — no tenant slug is hardcoded here. This used to
// be a hardcoded single-tenant allowlist (a blunt fix for a past incident
// where a manual run against the wrong tenant wrote mismatched-ICP prospects
// into another tenant — see event-scraper-runner.ts's tenant-scoping, which
// is the real fix for that bug). A tenant can turn this feature off for
// itself via tenants.settings.eventScraper.enabled = false; nothing needs to
// opt in.
import { createAdminClient } from "@/lib/supabase/admin";

export async function isEventScraperEnabledForTenant(
  tenantSlug: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const eventScraper = settings.eventScraper as { enabled?: boolean } | undefined;
  return eventScraper?.enabled !== false;
}
