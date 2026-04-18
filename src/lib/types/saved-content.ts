export type SavedContentStatus = "new" | "scheduled" | "used" | "archived";

export type ExtractionStatus =
  | "extracted"
  | "link_only"
  | "extraction_failed"
  | "pending";

export interface SavedContent {
  id: string;
  tenantSlug: string;
  title: string;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  intelCardId: string | null;
  trendScoutId: string | null;
  thumbnailEmoji: string | null;
  notes: string | null;
  tags: string[];
  bestFor: string[];
  status: SavedContentStatus;

  // Extraction pipeline (see migration 021).
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  storedPath: string | null;
  storedMime: string | null;
  fileSizeBytes: number | null;
  durationSec: number | null;
  authorHandle: string | null;
  thumbnailPath: string | null;
  contentHash: string | null;

  /** Resolved public URLs for client rendering (computed, not stored). */
  publicUrl: string | null;
  thumbnailUrl: string | null;

  createdAt: string;
  updatedAt: string;
}
