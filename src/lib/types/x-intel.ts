export interface XIntelConfig {
  keywords: string[];
  accounts: string[];
  min_engagement: number;
  enabled: boolean;
}

export interface XSignalCard {
  id: string;
  tenantSlug: string;
  signalType: "keyword" | "account_monitor" | "trending";
  matchedKeyword: string | null;
  accountHandle: string | null;
  tweetId: string;
  authorHandle: string;
  authorName: string | null;
  authorFollowers: number | null;
  tweetText: string;
  tweetUrl: string;
  likes: number;
  reposts: number;
  replies: number;
  postedAt: string;
  detectedAt: string;
  // Cached AI engagement suggestion (null = not yet generated)
  aiReply: string | null;
  aiQuoteTweet: string | null;
  aiAction: "reply" | "quote" | "both" | "skip" | null;
  aiScore: number | null;
  aiReasoning: string | null;
}
