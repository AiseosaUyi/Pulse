import { getCurrentTenant } from "@/lib/auth";
import { getKeywordRankings } from "@/lib/services/seo";
import { getLatestTopicalMap } from "@/lib/actions/topical-map";
import { TopicalMapClient } from "./client";

export default async function TopicalMapPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [keywords, savedMap] = await Promise.all([
    getKeywordRankings(tenantSlug),
    getLatestTopicalMap(tenantSlug),
  ]);
  const trackedKeywords = keywords.map((k) => k.keyword);

  return (
    <TopicalMapClient
      tenantSlug={tenantSlug}
      trackedKeywords={trackedKeywords}
      savedMap={savedMap}
    />
  );
}
