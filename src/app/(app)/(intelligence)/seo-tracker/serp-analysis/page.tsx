import { getCurrentTenant } from "@/lib/auth";
import { listSerpAnalyses } from "@/lib/services/serp";
import { getKeywordRankings } from "@/lib/services/seo";
import { SerpAnalysisClient } from "./client";

export default async function SerpAnalysisPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [analyses, keywords] = await Promise.all([
    listSerpAnalyses(tenantSlug),
    getKeywordRankings(tenantSlug),
  ]);

  return (
    <div>
      <div className="mb-5">
        <p className="text-foreground font-semibold text-lg">SERP analysis</p>
        <p className="text-text-muted text-xs mt-0.5 max-w-[640px]">
          Reverse-engineer what ranks for a keyword. AI reads Google&apos;s top
          10 + identifies the gap you could own.
        </p>
      </div>
      <SerpAnalysisClient
        analyses={analyses}
        tenantSlug={tenantSlug}
        trackedKeywords={keywords.map((k) => k.keyword)}
      />
    </div>
  );
}
