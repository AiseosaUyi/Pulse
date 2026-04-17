import { cookies } from "next/headers";
import { getKeywordRankings } from "@/lib/services/seo";
import { TopicalMapClient } from "./client";

export default async function TopicalMapPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const keywords = await getKeywordRankings(tenantSlug);
  const trackedKeywords = keywords.map((k) => k.keyword);

  return (
    <TopicalMapClient
      tenantSlug={tenantSlug}
      trackedKeywords={trackedKeywords}
    />
  );
}
