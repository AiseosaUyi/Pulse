import { cookies } from "next/headers";
import { getKeywordRankings } from "@/lib/services/seo";
import { getLatestTopicalMap } from "@/lib/actions/topical-map";
import { TopicalMapClient } from "./client";

export default async function TopicalMapPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

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
