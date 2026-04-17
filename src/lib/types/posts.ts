export type PostPlatform = "instagram" | "tiktok" | "twitter" | "linkedin";
export type PostContentType = "video" | "image" | "carousel" | "text";
export type PostPerformance = "above" | "average" | "below";

export interface Post {
  id: string;
  tenantSlug: string;
  title: string;
  platform: PostPlatform;
  contentType: PostContentType;
  postedAt: string;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  postUrl: string | null;
  notes: string | null;
  createdAt: string;
  engagementRate: number;
  performanceVsAvg: PostPerformance;
}

export interface PostSummary {
  total: number;
  totalReach: number;
  totalLikes: number;
  avgEngagement: number;
  aboveAvg: number;
}

export const POST_PLATFORM_LABELS: Record<PostPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
};

export const POST_CONTENT_TYPE_LABELS: Record<PostContentType, string> = {
  video: "Video",
  image: "Image",
  carousel: "Carousel",
  text: "Text",
};
