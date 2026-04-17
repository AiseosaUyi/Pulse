import { cookies } from "next/headers";
import { getIntelFeed, getMorningBrief, getWeeklyDigest, getCompetitors } from "@/lib/services/intelligence";
import { listBriefs } from "@/lib/services/briefs";
import { detectCrossBrandPatterns, detectAnomalies } from "@/lib/services/cross-brand";
import { MorningBriefing } from "@/components/intelligence/MorningBriefing";
import { IntelCard } from "@/components/intelligence/IntelCard";
import { WeeklyDigest } from "@/components/intelligence/WeeklyDigest";
import { CrossBrandInsights } from "@/components/intelligence/CrossBrandInsights";
import { AnomalyAlerts } from "@/components/intelligence/AnomalyAlerts";
import { IntelFeedClient } from "./client";

export default async function IntelFeedPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const tenantName = tenantSlug === "gruve" ? "Gruve" : "Sippy";

  const [feed, morningBrief, digest, briefs, competitors, patterns, anomalies] =
    await Promise.all([
      getIntelFeed(tenantSlug),
      getMorningBrief(tenantSlug),
      getWeeklyDigest(tenantSlug),
      listBriefs(tenantSlug),
      getCompetitors(tenantSlug),
      detectCrossBrandPatterns(),
      detectAnomalies(tenantSlug),
    ]);

  return (
    <div className="flex h-full">
      {/* Center: Intelligence Feed */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Intelligence Feed</h1>
            <p className="text-text-secondary text-sm mt-0.5">
              Competitor activity across {tenantName}&apos;s landscape
            </p>
          </div>
          <IntelFeedClient competitors={competitors} tenantSlug={tenantSlug} />
        </div>

        {/* Anomaly Alerts */}
        <AnomalyAlerts alerts={anomalies} />

        {/* Morning Briefing */}
        <MorningBriefing items={morningBrief} />

        {/* Cross-Brand Insights */}
        <CrossBrandInsights patterns={patterns} />

        {/* Feed */}
        {feed.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
            <div className="text-2xl mb-3">📡</div>
            <h3 className="text-foreground font-semibold mb-1">
              Add your first competitor to start tracking
            </h3>
            <p className="text-text-muted text-sm">
              Set up your competitor roster and paste their latest posts to get AI-powered intelligence.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {feed.map((card) => (
              <IntelCard key={card.id} card={card} tenantSlug={tenantSlug} />
            ))}
          </div>
        )}
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
