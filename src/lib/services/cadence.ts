// Read-side cadence service for pages. Loads config + recent post_log and
// computes the tracker view in the tenant's timezone. RLS applies (server
// client). The cron uses the admin variant below.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCadenceConfig } from "@/lib/cadence/config";
import { computeTracker, nowInTz } from "@/lib/cadence/compute";
import type { CadenceConfig, PostLogRow, Tracker } from "@/lib/cadence/types";

// 8 days back covers the 7-day strip plus today's tz boundary slack.
const LOOKBACK_DAYS = 8;

function sinceDate(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Page-facing: tracker for the current user's tenant (RLS). null when cadence isn't configured/enabled. */
export async function getTracker(tenantSlug: string): Promise<Tracker | null> {
  const config = await getCadenceConfig(tenantSlug);
  if (!config || !config.enabled) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_log")
    .select("posted_date, window_id, platform")
    .eq("tenant_slug", tenantSlug)
    .gte("posted_date", sinceDate(LOOKBACK_DAYS))
    .order("posted_date", { ascending: false });

  const rows = (error || !data ? [] : data) as PostLogRow[];
  return computeTracker(config, rows, nowInTz(config.timezone));
}

/** Cron-facing: same compute, but reads via admin (service-role can't pass is_tenant_member RPCs). */
export async function getTrackerAdmin(
  tenantSlug: string,
  config: CadenceConfig
): Promise<Tracker> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("post_log")
    .select("posted_date, window_id, platform")
    .eq("tenant_slug", tenantSlug)
    .gte("posted_date", sinceDate(LOOKBACK_DAYS));
  const rows = (data ?? []) as PostLogRow[];
  return computeTracker(config, rows, nowInTz(config.timezone));
}
