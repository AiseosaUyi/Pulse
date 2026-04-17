// ─── Weekly Report ────────────────────────────────────────────

export interface WeeklyReport {
  weekLabel: string;
  highlights: string[];
  socialReach: { value: number; change: number };
  engagement: { value: number; change: number };
  newFollowers: { value: number; change: number };
  topPost: { title: string; platform: string; reach: number; engagement: string };
  platformPerformance: { platform: string; posts: number; reach: number; engagement: string; trend: "up" | "down" | "stable" }[];
  leadsGenerated: number;
  adSpend: number;
  conversions: number;
  seoKeywordsImproved: number;
  contentPublished: number;
  recommendations: string[];
}

export const mockWeeklyReport: Record<string, WeeklyReport> = {
  gruve: {
    weekLabel: "Apr 7 — Apr 13, 2026",
    highlights: [
      "Social reach grew 18% this week, driven by the NYE recap reel on Instagram",
      "TikTok engagement rate (12.1%) was your highest this month",
      "3 warm leads went cold — Muse Events, Party Lagos, and Afrorave Crew need follow-up",
      "Keyword 'event ticketing Nigeria' moved from #15 to #11",
    ],
    socialReach: { value: 12400, change: 18 },
    engagement: { value: 842, change: 12 },
    newFollowers: { value: 145, change: 22 },
    topPost: { title: "Gruve NYE 2025 recap reel", platform: "Instagram", reach: 4200, engagement: "8.4%" },
    platformPerformance: [
      { platform: "Instagram", posts: 3, reach: 8500, engagement: "6.2%", trend: "up" },
      { platform: "TikTok", posts: 2, reach: 4600, engagement: "10.0%", trend: "up" },
      { platform: "Twitter/X", posts: 1, reach: 1900, engagement: "4.8%", trend: "down" },
      { platform: "LinkedIn", posts: 0, reach: 0, engagement: "0%", trend: "down" },
    ],
    leadsGenerated: 2,
    adSpend: 0,
    conversions: 0,
    seoKeywordsImproved: 5,
    contentPublished: 6,
    recommendations: [
      "Post at least 2 TikToks this week — your engagement rate there is 3x higher than Instagram",
      "Follow up with Muse Events and Party Lagos immediately — they've been cold for 2+ weeks",
      "LinkedIn had 0 posts this week. Even 1 thought-leadership post would maintain your presence",
      "The 'event ticketing Nigeria' keyword is at #11 — publish the planned blog post to push into top 10",
      "Your ad campaigns are paused. Consider reactivating with the April event approaching",
    ],
  },
  sippy: {
    weekLabel: "Apr 7 — Apr 13, 2026",
    highlights: [
      "The signature cocktail TikTok went semi-viral: 12K reach, 14.5% engagement",
      "Time Out Lagos mentioned Sippy — a full review is coming Friday",
      "Heineken Nigeria wants to discuss sponsorship terms",
      "2 Instagram DMs are unread and need response",
    ],
    socialReach: { value: 3500, change: 24 },
    engagement: { value: 1750, change: 35 },
    newFollowers: { value: 220, change: 45 },
    topPost: { title: "Signature cocktail reveal", platform: "TikTok", reach: 12000, engagement: "14.5%" },
    platformPerformance: [
      { platform: "Instagram", posts: 3, reach: 7300, engagement: "8.1%", trend: "up" },
      { platform: "TikTok", posts: 1, reach: 12000, engagement: "14.5%", trend: "up" },
    ],
    leadsGenerated: 3,
    adSpend: 45000,
    conversions: 295,
    seoKeywordsImproved: 4,
    contentPublished: 4,
    recommendations: [
      "Capitalize on the TikTok momentum — post 2 more cocktail videos this week using the same format",
      "Respond to the Heineken DM today — sponsor interest cools fast",
      "The Time Out Lagos review drops Friday — prepare a repost strategy across all platforms",
      "Victoria Island neighborhood page is ranking #6 — boost with a targeted blog post",
    ],
  },
};

// ─── Notifications ────────────────────────────────────────────

export interface Notification {
  id: string;
  type: "warning" | "opportunity" | "action" | "info";
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  actionUrl: string;
  actionLabel: string;
}

export const mockNotifications: Record<string, Notification[]> = {
  gruve: [
    { id: "n1", type: "warning", title: "TikTok inactive for 11 days", description: "Your TikTok account hasn't posted in 11 days. Engagement drops 40% after 7 days of inactivity.", timestamp: "Just now", read: false, actionUrl: "/ai-content", actionLabel: "Create post" },
    { id: "n2", type: "action", title: "3 leads going cold", description: "Muse Events, Party Lagos, and Afrorave Crew haven't been contacted in 2+ weeks.", timestamp: "2 hours ago", read: false, actionUrl: "/leads", actionLabel: "Follow up" },
    { id: "n3", type: "opportunity", title: "Keyword #11 → Top 10 possible", description: "'Event ticketing Nigeria' moved 4 positions this week. One blog post could push it into the top 10.", timestamp: "5 hours ago", read: false, actionUrl: "/seo-tracker/blog-writer", actionLabel: "Write post" },
    { id: "n4", type: "info", title: "Instagram reach up 18%", description: "Your Instagram reach grew 18% this week, driven by the NYE recap reel.", timestamp: "1 day ago", read: true, actionUrl: "/platform-score", actionLabel: "View details" },
    { id: "n5", type: "warning", title: "LinkedIn has 0 posts this month", description: "LinkedIn is your least active platform. Even 1 post per week maintains professional visibility.", timestamp: "1 day ago", read: true, actionUrl: "/ai-content", actionLabel: "Create post" },
    { id: "n6", type: "opportunity", title: "2 unread DMs on Instagram", description: "Potential partnership inquiry from Party Lagos and a VIP ticket question.", timestamp: "2 days ago", read: true, actionUrl: "/engagement", actionLabel: "View inbox" },
  ],
  sippy: [
    { id: "n7", type: "opportunity", title: "Heineken wants to discuss sponsorship", description: "Heineken Nigeria replied to your sponsorship proposal. They want to discuss terms.", timestamp: "1 hour ago", read: false, actionUrl: "/leads", actionLabel: "View lead" },
    { id: "n8", type: "info", title: "TikTok reel hit 12K reach", description: "Your signature cocktail TikTok is outperforming your average by 4x. Consider boosting it.", timestamp: "3 hours ago", read: false, actionUrl: "/ads-tracker", actionLabel: "Boost post" },
    { id: "n9", type: "action", title: "Time Out Lagos review dropping Friday", description: "Prepare repost strategy across all platforms before the review goes live.", timestamp: "5 hours ago", read: false, actionUrl: "/ai-content", actionLabel: "Plan content" },
    { id: "n10", type: "warning", title: "2 unread DMs need response", description: "Table booking request and a food blogger collab inquiry.", timestamp: "1 day ago", read: true, actionUrl: "/engagement", actionLabel: "View inbox" },
  ],
};
