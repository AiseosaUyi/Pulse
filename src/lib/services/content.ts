import type { ContentBrief } from "@/lib/types/intelligence";
import { supabase } from "@/lib/supabase/client";

export async function getContentBriefs(
  tenantSlug: string
): Promise<ContentBrief[]> {
  const { data, error } = await supabase
    .from("content_briefs")
    .select("*")
    .eq("tenant_id", tenantSlug)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    triggeredBy: row.triggered_by,
    platform: row.platform,
    contentType: row.content_type,
    title: row.title,
    outline: row.outline ?? [],
    draftContent: row.draft_content ?? "",
    seoKeywords: row.seo_keywords ?? [],
    status: row.status,
    generatedAt: row.created_at,
  }));
}

export async function getContentBrief(
  tenantSlug: string,
  briefId: string
): Promise<ContentBrief | null> {
  const { data, error } = await supabase
    .from("content_briefs")
    .select("*")
    .eq("tenant_id", tenantSlug)
    .eq("id", briefId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    tenantId: data.tenant_id,
    triggeredBy: data.triggered_by,
    platform: data.platform,
    contentType: data.content_type,
    title: data.title,
    outline: data.outline ?? [],
    draftContent: data.draft_content ?? "",
    seoKeywords: data.seo_keywords ?? [],
    status: data.status,
    generatedAt: data.created_at,
  };
}
