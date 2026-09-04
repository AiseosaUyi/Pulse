export const OUTBOUND_PLATFORMS = [
  "instagram",
  "tiktok",
  "twitter",
  "linkedin",
  "manual",
  "other",
] as const;

export type OutboundPlatform = (typeof OUTBOUND_PLATFORMS)[number];

export const SIGNAL_TYPES = [
  "keyword",
  "hashtag",
  "event_host",
  "event_attendee",
  "recent_post",
  "manual",
  "ticketing_platform",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const PROSPECT_STATUSES = [
  "new",
  "qualifying",
  "qualified",
  "unqualified",
  "drafted",
  "approved",
  "sent",
  "replied",
  "handed_off",
  "closed_won",
  "closed_lost",
  "dismissed",
] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const PROSPECT_QUALITIES = [
  "unscored",
  "hot",
  "warm",
  "cold",
  "dead",
] as const;

export type ProspectQuality = (typeof PROSPECT_QUALITIES)[number];

export const DM_STATUSES = [
  "drafted",
  "approved",
  "sent",
  "failed",
  "replied",
  "cancelled",
] as const;

export type OutboundDmStatus = (typeof DM_STATUSES)[number];

export interface ProspectSearchRecord {
  id: string;
  tenantSlug: string;
  name: string;
  platform: OutboundPlatform;
  signalType: SignalType;
  query: string;
  filters: Record<string, unknown>;
  lastRunAt: string | null;
  lastResultCount: number;
  autoQualify: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectRecord {
  id: string;
  tenantSlug: string;
  searchId: string | null;
  platform: OutboundPlatform;
  handle: string;
  /** Stable platform account id, when known — Instagram handles can (and
   * do) change; this is what upsertProspect prefers as the conflict
   * target over handle when present, so a renamed account updates instead
   * of creating a duplicate. Null for prospects discovered before this
   * existed, or on platforms with no stable id available. */
  externalAccountId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number | null;
  signalSummary: string | null;
  signalData: Record<string, unknown>;
  qualificationScore: number | null;
  qualificationReason: string | null;
  status: ProspectStatus;
  quality: ProspectQuality;
  duplicateOfId: string | null;
  notes: string | null;
  category: string | null;
  location: string | null;
  verifiedName: string | null;
  eventTitle: string | null;
  phone: string | null;
  lastReachoutAt: string | null;
  lastTouchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundDmRecord {
  id: string;
  tenantSlug: string;
  prospectId: string;
  version: number;
  body: string;
  followupBody: string | null;
  status: OutboundDmStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  externalId: string | null;
  error: string | null;
  generatorModel: string | null;
  generatorCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessageRecord {
  id: string;
  tenantSlug: string;
  prospectId: string | null;
  inReplyToDmId: string | null;
  platform: string;
  body: string;
  externalId: string | null;
  receivedAt: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * True when a prospect's `handle` is a synthesized slug (e.g.
 * "event-egotickets-korle-woko") rather than a real, resolved social
 * handle. The event-platform scraper falls back to this shape when
 * SERP-based handle resolution fails, and stamps
 * `signal_data.resolved_via = "unresolved"` at write time — this
 * reads that flag back so the UI never presents a synthetic slug as
 * a verified identity.
 */
export function isUnresolvedProspectHandle(
  prospect: Pick<ProspectRecord, "signalData">
): boolean {
  return prospect.signalData?.resolved_via === "unresolved";
}

export const PLATFORM_LABELS: Record<OutboundPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  manual: "Manual entry",
  other: "Other",
};

export const SIGNAL_LABELS: Record<SignalType, string> = {
  keyword: "Keyword in posts",
  hashtag: "Hashtag",
  event_host: "Event host",
  event_attendee: "Event attendee",
  recent_post: "Recent post",
  manual: "Manual",
  ticketing_platform: "Ticketing platform",
};

export const QUALITY_LABELS: Record<ProspectQuality, string> = {
  unscored: "Unscored",
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
  dead: "Dead",
};

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "New",
  qualifying: "AI qualifying",
  qualified: "Qualified",
  unqualified: "Skip",
  drafted: "DM drafted",
  approved: "Approved to send",
  sent: "Sent",
  replied: "Replied",
  handed_off: "Human handed off",
  closed_won: "Won",
  closed_lost: "Lost",
  dismissed: "Dismissed",
};
