export type ContentSlotStatus =
  | "assigned"
  | "in_progress"
  | "filmed"
  | "posted"
  | "skipped";

export interface ContentSlotReferenceLink {
  url: string;
  title: string;
}

export interface ContentSlotBrief {
  talkingPoints: string[];
  stat: string | null;
  statSourceUrl: string | null;
  contrarianAngle: string | null;
  referenceLinks: ContentSlotReferenceLink[];
  noReferencesFound: boolean;
  // Real posts/videos other creators made about this topic (TikTok/YouTube
  // Shorts/Instagram/X), separate from generic news/article referenceLinks —
  // "what others are doing" so you can see how it's already being covered.
  // Defaults to [] for slots generated before this field existed.
  creatorExamples: ContentSlotReferenceLink[];
  noCreatorExamplesFound: boolean;
}

export interface ContentSlotRecord {
  id: string;
  tenantSlug: string;
  position: number;
  // Calendar placement — provisional, not fixed: rolls forward to today if
  // it passes unposted (see content-calendar-lifecycle.ts). `position`
  // stays as the stable secondary sort key for same-day ordering.
  scheduledDate: string; // YYYY-MM-DD
  status: ContentSlotStatus;
  topicTitle: string;
  topicBrief: ContentSlotBrief;
  notes: string | null;
  videoAssetUrl: string | null;
  platforms: string[];
  retiredReason: string | null;
  generatedAt: string;
  postedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// Staleness/backpressure thresholds — locked decisions #11/#13 (design
// doc ENG REVIEW). Computed at read time, not stored as a mutating flag.
export const STALE_AFTER_DAYS = 8;
export const AUTO_RETIRE_AFTER_DAYS = 21;
export const MAX_QUEUE_DEPTH = 20;
export const MAX_BATCH_SIZE = 5;

export function isSlotStale(slot: Pick<ContentSlotRecord, "generatedAt" | "status">): boolean {
  if (slot.status === "posted" || slot.status === "skipped") return false;
  const ageMs = Date.now() - new Date(slot.generatedAt).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
