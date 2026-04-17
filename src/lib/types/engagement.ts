export type EngagementType = "dm" | "comment" | "mention" | "reply";
export type EngagementPlatform = "instagram" | "tiktok" | "twitter" | "linkedin";
export type EngagementSentiment = "positive" | "neutral" | "negative" | "question";

export interface EngagementItem {
  id: string;
  tenantSlug: string;
  type: EngagementType;
  platform: EngagementPlatform;
  fromName: string;
  fromHandle: string | null;
  fromAvatar: string | null;
  content: string;
  postTitle: string | null;
  externalUrl: string | null;
  receivedAt: string;
  read: boolean;
  replied: boolean;
  sentiment: EngagementSentiment;
  notes: string | null;
  createdAt: string;
}

export interface EngagementSummary {
  total: number;
  unread: number;
  unreplied: number;
  dms: number;
  mentions: number;
  comments: number;
}

export const ENGAGEMENT_TYPE_LABELS: Record<EngagementType, string> = {
  dm: "DM",
  comment: "Comment",
  mention: "Mention",
  reply: "Reply",
};

export const ENGAGEMENT_PLATFORM_LABELS: Record<EngagementPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
};

export const ENGAGEMENT_SENTIMENT_LABELS: Record<EngagementSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  question: "Question",
};
