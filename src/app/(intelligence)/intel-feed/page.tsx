import { cookies } from "next/headers";
import { getIntelFeed, getMorningBrief, getWeeklyDigest } from "@/lib/services/intelligence";
import { getContentBriefs } from "@/lib/services/content";
import { MorningBriefing } from "@/components/intelligence/MorningBriefing";
import { IntelCard } from "@/components/intelligence/IntelCard";
import { WeeklyDigest } from "@/components/intelligence/WeeklyDigest";

export default async function IntelFeedPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const tenantName = tenantSlug === "gruve" ? "Gruve" : "Sippy";

  const [feed, morningBrief, digest, briefs] = await Promise.all([
    getIntelFeed(tenantSlug),
    getMorningBrief(tenantSlug),
    getWeeklyDigest(tenantSlug),
    getContentBriefs(tenantSlug),
  ]);

  return (
    <div className="flex h-full">
      {/* Center: Intelligence Feed */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Intelligence Feed</h1>
            <p className="text-text-secondary text-sm mt-0.5">
              Competitor activity across {tenantName}&apos;s landscape
            </p>
          </div>
          <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-accent-purple to-accent-pink hover:opacity-90 transition-opacity">
            + Add Competitor Post
          </button>
        </div>

        {/* Morning Briefing */}
        <MorningBriefing items={morningBrief} />

        {/* Feed */}
        {feed.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
            <div className="text-2xl mb-3">📡</div>
            <h3 className="text-white font-semibold mb-1">
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
      <div className="hidden lg:block w-80 border-l border-border/50 bg-[#0d0d14] overflow-y-auto shrink-0">
        <WeeklyDigest
          digest={digest}
          tenantName={tenantName}
          briefCount={briefs.length}
        />
      </div>
    </div>
  );
}
