"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getIntegrationSecrets } from "@/lib/services/integrations";
import { fetchGa4DailyByPage } from "@/lib/integrations/ga4";
import { upsertDailyAnalytics } from "@/lib/services/analytics";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * On-demand GA4 sync. The nightly cron at /api/cron/sync-ga4 loops
 * across tenants; this lets an owner trigger a refresh manually
 * from the dashboard.
 */
export async function syncGa4(
  tenantSlug: string,
  days = 30
): Promise<ActionResult<{ rows: number }>> {
  await requireUser();
  const creds = await getIntegrationSecrets(tenantSlug, "ga4");
  if (!creds?.secretToken) {
    return { success: false, error: "GA4 integration not configured" };
  }
  const propertyId = String(creds.config.property_id ?? "");
  if (!propertyId) {
    return { success: false, error: "GA4 property ID missing" };
  }

  try {
    const rows = await fetchGa4DailyByPage({
      propertyId,
      serviceAccountJson: creds.secretToken,
      startDate: `${days}daysAgo`,
      endDate: "today",
    });
    const res = await upsertDailyAnalytics(
      tenantSlug,
      rows.map((r) => ({
        source: "ga4" as const,
        pagePath: r.pagePath,
        date: r.date,
        pageviews: r.pageviews,
        sessions: r.sessions,
        users: r.users,
        engagementTimeSec: r.engagementTimeSec,
        bounceRate: r.bounceRate,
        conversions: r.conversions,
        raw: {},
      }))
    );
    if (res.error) return { success: false, error: res.error };
    revalidatePath("/dashboard");
    revalidatePath("/own-analytics");
    return { success: true, rows: rows.length };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "GA4 sync failed",
    };
  }
}
