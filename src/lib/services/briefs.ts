import type { ContentBrief, ContentBriefStatus } from "@/lib/types/intelligence";
import { createClient } from "@/lib/supabase/server";

interface BriefRow {
  id: string;
  tenant_id: string;
  triggered_by: string | null;
  triggered_by_type: "intel_card" | "manual";
  platform: string;
  content_type: string;
  title: string;
  outline: string[] | null;
  draft_content: string | null;
  seo_keywords: string[] | null;
  status: ContentBriefStatus;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  generator_model: string | null;
  created_at: string;
  intel_cards?: {
    competitor_name: string;
    platform: string;
  } | null;
}

function rowToBrief(row: BriefRow): ContentBrief {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    triggeredBy: row.triggered_by,
    triggeredByType: row.triggered_by_type,
    platform: row.platform,
    contentType: row.content_type,
    title: row.title,
    outline: row.outline ?? [],
    draftContent: row.draft_content ?? "",
    seoKeywords: row.seo_keywords ?? [],
    status: row.status,
    dismissedAt: row.dismissed_at,
    dismissedReason: row.dismissed_reason,
    generatorModel: row.generator_model,
    generatedAt: row.created_at,
    competitorName: row.intel_cards?.competitor_name,
    competitorPlatform: row.intel_cards?.platform,
  };
}

export async function listBriefs(
  tenantSlug: string,
  options: { includeDismissed?: boolean; limit?: number } = {}
): Promise<ContentBrief[]> {
  const supabase = await createClient();
  let query = supabase
    .from("content_briefs")
    .select("*, intel_cards!triggered_by(competitor_name, platform)")
    .eq("tenant_id", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (!options.includeDismissed) {
    query = query.neq("status", "dismissed");
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as BriefRow[]).map(rowToBrief);
}

export async function getBrief(
  tenantSlug: string,
  briefId: string
): Promise<ContentBrief | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_briefs")
    .select("*, intel_cards!triggered_by(competitor_name, platform)")
    .eq("tenant_id", tenantSlug)
    .eq("id", briefId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToBrief(data as unknown as BriefRow);
}
