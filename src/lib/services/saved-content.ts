import { createClient } from "@/lib/supabase/server";
import { publicUrlFor } from "@/lib/storage/save-asset";
import type {
  SavedContent,
  SavedContentStatus,
  ExtractionStatus,
} from "@/lib/types/saved-content";

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
  extraction_status: string;
  extraction_error: string | null;
  stored_path: string | null;
  stored_mime: string | null;
  file_size_bytes: number | null;
  duration_sec: number | null;
  author_handle: string | null;
  thumbnail_path: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

function toStatus(v: string): SavedContentStatus {
  return v === "scheduled" || v === "used" || v === "archived" ? v : "new";
}

function toExtractionStatus(v: string): ExtractionStatus {
  return v === "extracted" ||
    v === "extraction_failed" ||
    v === "pending"
    ? v
    : "link_only";
}

function rowTo(row: Row): SavedContent {
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
    status: toStatus(row.status),
    extractionStatus: toExtractionStatus(row.extraction_status),
    extractionError: row.extraction_error,
    storedPath: row.stored_path,
    storedMime: row.stored_mime,
    fileSizeBytes: row.file_size_bytes,
    durationSec: row.duration_sec,
    authorHandle: row.author_handle,
    thumbnailPath: row.thumbnail_path,
    contentHash: row.content_hash,
    publicUrl: publicUrlFor(row.stored_path),
    thumbnailUrl: publicUrlFor(row.thumbnail_path),
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
