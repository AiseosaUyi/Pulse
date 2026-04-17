"use server";

import { getTenant } from "@/lib/services/tenants";
import { getKeywordRankings } from "@/lib/services/seo";
import {
  clusterKeywords,
  type KeywordClustering,
} from "@/lib/ai/cluster-keywords";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function generateTopicalMap(
  tenantSlug: string
): Promise<ActionResult<{ clustering: KeywordClustering }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const keywords = await getKeywordRankings(tenantSlug);
  if (keywords.length < 3) {
    return {
      success: false,
      error: `Need at least 3 tracked keywords to build a topical map (currently ${keywords.length}).`,
    };
  }

  try {
    const clustering = await clusterKeywords({
      tenantSlug,
      tenantName: tenant.name,
      keywords: keywords.map((k) => k.keyword),
    });
    return { success: true, clustering };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Clustering failed",
    };
  }
}
