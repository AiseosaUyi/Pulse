// Nightly GA4 → web_analytics_daily sync. For every tenant with a connected
// GA4 integration, pull the last few days (to catch late-arriving data) and
// upsert. No-ops cleanly when no tenant has GA4 configured.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { getIntegrationSecrets } from "@/lib/services/integrations";
import { fetchGa4DailyByPage } from "@/lib/integrations/ga4";
import { upsertDailyAnalytics } from "@/lib/services/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOOKBACK = "3daysAgo";

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("ga4-sync", async () => {
    const admin = createAdminClient();
    const summary = {
      tenantsProcessed: 0,
      rowsUpserted: 0,
      failed: 0,
      errors: [] as { tenant: string; message: string }[],
    };

    const { data: rows } = await admin
      .from("tenant_integrations")
      .select("tenant_slug")
      .eq("provider", "ga4")
      .neq("status", "disconnected");

    for (const { tenant_slug } of (rows ?? []) as { tenant_slug: string }[]) {
      summary.tenantsProcessed += 1;
      try {
        const secrets = await getIntegrationSecrets(tenant_slug, "ga4");
        const propertyId = secrets?.config?.property_id as string | undefined;
        const serviceAccountJson = secrets?.secretToken;
        if (!propertyId || !serviceAccountJson) {
          summary.failed += 1;
          summary.errors.push({ tenant: tenant_slug, message: "missing GA4 config" });
          continue;
        }

        const daily = await fetchGa4DailyByPage({
          propertyId,
          serviceAccountJson,
          startDate: LOOKBACK,
          endDate: "today",
        });

        const { inserted, error } = await upsertDailyAnalytics(
          tenant_slug,
          daily.map((d) => ({ ...d, source: "ga4" as const, raw: {} }))
        );
        if (error) throw new Error(error);
        summary.rowsUpserted += inserted;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          tenant: tenant_slug,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const status =
      summary.failed === 0 ? "ok" : summary.rowsUpserted > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.rowsUpserted, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
