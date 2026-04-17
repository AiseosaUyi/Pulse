export type SavedContentStatus = "new" | "scheduled" | "used" | "archived";

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
  createdAt: string;
  updatedAt: string;
}
