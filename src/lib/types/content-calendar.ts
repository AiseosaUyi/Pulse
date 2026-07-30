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
  // One plain-language orientation sentence — why this is worth talking
  // about right now, written for someone who may be new to this specific
  // topic. Sits above talkingPoints so a beginner isn't dropped straight
  // into bullets assuming context they don't have yet. Defaults to "" for
  // slots generated before this field existed.
  whyItMatters: string;
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
  // Which of the tenant's configured content pillars this topic was picked
  // from (see content-calendar/config.ts `niches`) — null for slots
  // generated before pillars existed, or if the AI didn't report one.
  pillar: string | null;
  format: string | null;
  category?: string | null;
}

export const CONTENT_CATEGORY_OPTIONS = [
  "Educational & How-To",
  "Product Walkthrough",
  "Personal Story & Journey",
  "Hot Take & Debunking",
  "Tools & Listicle",
  "Teardown & Analysis",
  "Behind The Scenes",
] as const;


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
// Open-queue depth cap REMOVED (2026-07-29) — generateNextBatch and the
// manual add-slot actions no longer block on how many open slots already
// exist. Removed rather than raised: a hardcoded number kept being wrong in
// one direction or the other (20 was too many to work through, 10 blocked
// legitimate batches once the backlog already exceeded it) — staleness
// auto-retirement (STALE_AFTER_DAYS/AUTO_RETIRE_AFTER_DAYS) is the actual
// backpressure mechanism now.
// Per-click ceiling on generateNextBatch — bounded by the route's
// maxDuration (300s): topic-selection is sequential (each pick must see
// every earlier pick this round) so this is the real cost driver.
export const MAX_BATCH_SIZE = 10;
export const BATCH_SIZE_OPTIONS = [5, 10] as const;
export const DEFAULT_BATCH_SIZE = 10;

export function isSlotStale(slot: Pick<ContentSlotRecord, "generatedAt" | "status">): boolean {
  if (slot.status === "posted" || slot.status === "skipped") return false;
  const ageMs = Date.now() - new Date(slot.generatedAt).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
