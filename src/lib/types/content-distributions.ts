export const DISTRIBUTION_FORMATS = [
  "twitter_thread",
  "linkedin_post",
  "instagram_carousel",
  "tiktok_hook",
  "email",
  "newsletter",
  "reddit_comment",
  "youtube_short",
] as const;

export type DistributionFormat = (typeof DISTRIBUTION_FORMATS)[number];

export type DistributionStatus =
  | "draft"
  | "approved"
  | "scheduled"
  | "published"
  | "dismissed";

export interface ContentDistributionRecord {
  id: string;
  tenantSlug: string;
  blogPostId: string;
  format: DistributionFormat;
  content: string;
  status: DistributionStatus;
  scheduledAt: string | null;
  generatorModel: string | null;
  generatorCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export const FORMAT_LABELS: Record<DistributionFormat, string> = {
  twitter_thread: "X / Twitter thread",
  linkedin_post: "LinkedIn post",
  instagram_carousel: "Instagram carousel",
  tiktok_hook: "TikTok hook",
  email: "Email",
  newsletter: "Newsletter blurb",
  reddit_comment: "Reddit comment",
  youtube_short: "YouTube Short script",
};
