import { cookies } from "next/headers";
import { getIntelFeed, getMorningBrief, getWeeklyDigest, getCompetitors } from "@/lib/services/intelligence";
import { getXSignalCards } from "@/lib/services/x-intel";
import { listBriefs } from "@/lib/services/briefs";
import { detectCrossBrandPatterns, detectAnomalies } from "@/lib/services/cross-brand";
import { MorningBriefing } from "@/components/intelligence/MorningBriefing";
import { WeeklyDigest } from "@/components/intelligence/WeeklyDigest";
import { CrossBrandInsights } from "@/components/intelligence/CrossBrandInsights";
import { AnomalyAlerts } from "@/components/intelligence/AnomalyAlerts";
import { IntelFeedTabs } from "./client";

export default async function IntelFeedPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const tenantName = tenantSlug === "gruve" ? "Gruve" : "Sippy";

  const [feed, morningBrief, digest, briefs, competitors, patterns, anomalies, xSignals] =
    await Promise.all([
      getIntelFeed(tenantSlug),
      getMorningBrief(tenantSlug),
      getWeeklyDigest(tenantSlug),
      listBriefs(tenantSlug),
      getCompetitors(tenantSlug),
      detectCrossBrandPatterns(),
      detectAnomalies(tenantSlug),
      getXSignalCards(tenantSlug),
    ]);

  return (
    <div className="flex h-full">
      {/* Center: Intelligence Feed */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className="text-2xl text-gray-1100 dark:text-foreground tracking-tight"
              style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
            >
              Intelligence Feed
            </h1>
            <p className="text-gray-1000 dark:text-text-secondary text-sm mt-0.5">
              Competitor activity and X signals for {tenantName}
            </p>
          </div>
        </div>

        {/* Anomaly Alerts */}
        <AnomalyAlerts alerts={anomalies} />

        {/* Morning Briefing */}
        <MorningBriefing items={morningBrief} />

        {/* Cross-Brand Insights */}
        <CrossBrandInsights patterns={patterns} />

        {/* Tabbed feed: Competitor Intel + X Signals */}
        <IntelFeedTabs
          feed={feed}
          xSignals={xSignals}
          competitors={competitors}
          tenantSlug={tenantSlug}
        />
      </div>

      {/* Right: Weekly Digest (hidden on mobile/tablet, visible on lg+) */}
      <div className="hidden lg:block w-80 border-l border-border bg-sidebar overflow-y-auto shrink-0">
        <WeeklyDigest
          digest={digest}
          tenantName={tenantName}
          briefCount={briefs.length}
        />
      </div>
    </div>
  );
}
