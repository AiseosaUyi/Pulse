import { createClient } from "@/lib/supabase/server";
import type { SavedContent, SavedContentStatus } from "@/lib/types/saved-content";

interface Row {
  id: string;
  tenant_slug: string;
  title: string;
  source_platform: string | null;
  source_url: string | null;
  intel_card_id: string | null;
  trend_scout_id: string | null;
  thumbnail_emoji: string | null;
  notes: string | null;
  tags: string[] | null;
  best_for: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowTo(row: Row): SavedContent {
  const status: SavedContentStatus =
    row.status === "scheduled" || row.status === "used" || row.status === "archived"
      ? row.status
      : "new";
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    title: row.title,
    sourcePlatform: row.source_platform,
    sourceUrl: row.source_url,
    intelCardId: row.intel_card_id,
    trendScoutId: row.trend_scout_id,
    thumbnailEmoji: row.thumbnail_emoji,
    notes: row.notes,
    tags: row.tags ?? [],
    bestFor: row.best_for ?? [],
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSavedContent(
  tenantSlug: string,
  options: { limit?: number } = {}
): Promise<SavedContent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_content")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 100);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}
