import { getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listOwnMetrics } from "@/lib/services/own-metrics";
import { UploadPanel } from "@/components/own-analytics/UploadPanel";
import { ZipUploadSection } from "@/components/own-analytics/ZipUploadSection";
import { PlatformTabsClient } from "@/components/own-analytics/PlatformTabsClient";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

async function getLatestReport(tenantSlug: string, platform: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("analytics_ai_reports")
    .select("narrative, recommendations, generated_at")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

const PLATFORMS: OwnMetricsPlatform[] = ["instagram", "twitter", "tiktok", "linkedin"];

export default async function OwnAnalyticsPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [allMetrics, ...reports] = await Promise.all([
    listOwnMetrics(tenantSlug, { limit: 500 }),
    ...PLATFORMS.map((p) => getLatestReport(tenantSlug, p)),
  ]);

  const reportsByPlatform = Object.fromEntries(
    PLATFORMS.map((p, i) => [p, reports[i]])
  );

  const hasPosts = allMetrics.length > 0;

  return (
    <div className="p-4 md:p-8 max-w-[1280px] space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Import your data, see the charts, get AI analysis.
        </p>
      </div>

      {/* Import section */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Add data</h2>
        {/* ZIP card takes 1 col; UploadPanel spans remaining 3 cols at xl */}
        <div className="grid xl:grid-cols-4 gap-4">
          <ZipUploadSection tenantSlug={tenantSlug} />
          <div className="xl:col-span-3">
            <UploadPanel tenantSlug={tenantSlug} compact />
          </div>
        </div>
      </section>

      {/* Platform tabs + analytics */}
      {hasPosts ? (
        <PlatformTabsClient
          posts={allMetrics}
          tenantSlug={tenantSlug}
          reportsByPlatform={reportsByPlatform}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/50 p-16 text-center">
          <p className="text-sm font-medium text-foreground mb-1">No data yet</p>
          <p className="text-xs text-text-muted">Upload a ZIP or CSV above to get started.</p>
        </div>
      )}
    </div>
  );
}
