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
  // Video content format (teardown/how_to/hot_take/personal_story/listicle/
  // news_reaction) — null for slots generated before format variety existed.
  format: string | null;
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
// Per-click ceiling on generateNextBatch — bounded by the route's
// maxDuration (300s): topic-selection is sequential (dedup requires each
// pick to see prior picks) so this is the real cost driver, ~2-5s/topic;
// briefing generation is concurrency-3. 15 stays well under budget even in
// a slow-call scenario. Raised from 5 (2026-07-09): a fixed batch of 5
// assumes the user already knows their direction — when they don't, they
// want more raw options to browse before committing to what to film.
export const MAX_BATCH_SIZE = 15;
export const BATCH_SIZE_OPTIONS = [5, 10, 15] as const;
export const DEFAULT_BATCH_SIZE = 10;

export function isSlotStale(slot: Pick<ContentSlotRecord, "generatedAt" | "status">): boolean {
  if (slot.status === "posted" || slot.status === "skipped") return false;
  const ageMs = Date.now() - new Date(slot.generatedAt).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
