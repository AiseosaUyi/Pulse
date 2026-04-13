// ─── Engagement Inbox ─────────────────────────────────────────

export interface EngagementItem {
  id: string;
  type: "comment" | "dm" | "mention" | "reply";
  platform: "instagram" | "tiktok" | "twitter" | "linkedin";
  from: { name: string; handle: string; avatarEmoji: string };
  content: string;
  postTitle?: string;
  timestamp: string;
  read: boolean;
  replied: boolean;
  sentiment: "positive" | "neutral" | "negative" | "question";
}

export const mockEngagement: Record<string, EngagementItem[]> = {
  gruve: [
    { id: "e1", type: "dm", platform: "instagram", from: { name: "Tolu Adeyemi", handle: "@tolu_vibes", avatarEmoji: "👤" }, content: "Hi! How much are VIP tickets for the April show? Can I get a group discount for 8 people?", timestamp: "2 hours ago", read: false, replied: false, sentiment: "question" },
    { id: "e2", type: "comment", platform: "instagram", from: { name: "Chika Okonkwo", handle: "@chikaok", avatarEmoji: "🎵" }, content: "This lineup is INSANE 🔥🔥 Already got my tickets!", postTitle: "Artist lineup announcement", timestamp: "3 hours ago", read: false, replied: false, sentiment: "positive" },
    { id: "e3", type: "mention", platform: "twitter", from: { name: "Lagos Events Blog", handle: "@lagosevents", avatarEmoji: "📰" }, content: "Shoutout to @gruve_events for the best ticketing experience in Lagos. Smooth checkout, instant QR code. This is how it should be done.", timestamp: "5 hours ago", read: true, replied: false, sentiment: "positive" },
    { id: "e4", type: "comment", platform: "tiktok", from: { name: "DJ_Melo", handle: "@dj_melo_ng", avatarEmoji: "🎧" }, content: "The sound check video was fire! When's the next event in Abuja?", postTitle: "Behind the scenes: Sound check", timestamp: "6 hours ago", read: true, replied: true, sentiment: "question" },
    { id: "e5", type: "dm", platform: "instagram", from: { name: "Party Lagos", handle: "@partylagos", avatarEmoji: "🎉" }, content: "Would love to collab on promoting each other's events. We have 12K engaged followers in Lagos nightlife.", timestamp: "8 hours ago", read: true, replied: false, sentiment: "positive" },
    { id: "e6", type: "comment", platform: "instagram", from: { name: "Bisi Afolabi", handle: "@bisi_a", avatarEmoji: "😤" }, content: "I bought tickets but never received the confirmation email. This is the second time. Please fix this!", postTitle: "Gruve NYE 2025 recap reel", timestamp: "10 hours ago", read: true, replied: true, sentiment: "negative" },
    { id: "e7", type: "mention", platform: "linkedin", from: { name: "TechCabal", handle: "TechCabal", avatarEmoji: "💼" }, content: "Nigerian event ticketing startup @Gruve raises the bar for live experiences in West Africa. Feature coming soon.", timestamp: "12 hours ago", read: true, replied: false, sentiment: "positive" },
    { id: "e8", type: "reply", platform: "twitter", from: { name: "Kunle O.", handle: "@kunle_o", avatarEmoji: "🙋" }, content: "Will there be a livestream option for people outside Lagos? Not everyone can travel!", timestamp: "1 day ago", read: true, replied: true, sentiment: "question" },
    { id: "e9", type: "dm", platform: "tiktok", from: { name: "ViralNaija", handle: "@viralnaija", avatarEmoji: "📱" }, content: "Your event videos are performing really well. Want to do a paid promotion? We can get you 50K+ views.", timestamp: "1 day ago", read: true, replied: false, sentiment: "positive" },
    { id: "e10", type: "comment", platform: "instagram", from: { name: "Amaka N.", handle: "@amaka_styles", avatarEmoji: "👗" }, content: "What's the dress code for the April event? Can I wear sneakers or is it strictly formal?", postTitle: "Artist lineup announcement", timestamp: "1 day ago", read: true, replied: true, sentiment: "question" },
  ],
  sippy: [
    { id: "e11", type: "dm", platform: "instagram", from: { name: "Funke Adeoye", handle: "@funke_eats", avatarEmoji: "🍽" }, content: "Can I book a table for 6 this Saturday? Also, do you have a cocktail menu I can see beforehand?", timestamp: "1 hour ago", read: false, replied: false, sentiment: "question" },
    { id: "e12", type: "comment", platform: "tiktok", from: { name: "Lagos Foodie", handle: "@lagosfoodie", avatarEmoji: "🍸" }, content: "That Sippy Sunset cocktail looks AMAZING. Definitely coming this weekend!", postTitle: "Signature cocktail reveal", timestamp: "3 hours ago", read: false, replied: false, sentiment: "positive" },
    { id: "e13", type: "mention", platform: "instagram", from: { name: "Time Out Lagos", handle: "@timeoutlagos", avatarEmoji: "📍" }, content: "New on our radar: @sippy.ng on Victoria Island. The cocktails are creative, the vibe is impeccable. Full review dropping Friday.", timestamp: "5 hours ago", read: true, replied: false, sentiment: "positive" },
    { id: "e14", type: "comment", platform: "instagram", from: { name: "Emeka J.", handle: "@emeka_j", avatarEmoji: "😕" }, content: "Waited 45 minutes for a table last Friday with a reservation. Please sort out the wait times.", postTitle: "Saturday launch party highlights", timestamp: "8 hours ago", read: true, replied: true, sentiment: "negative" },
    { id: "e15", type: "dm", platform: "instagram", from: { name: "Heineken Nigeria", handle: "@heineken_ng", avatarEmoji: "🍺" }, content: "Following up on the sponsorship proposal. Our brand team reviewed it and we'd like to discuss terms. When are you available?", timestamp: "1 day ago", read: true, replied: false, sentiment: "positive" },
  ],
};

// ─── Content Performance History ──────────────────────────────

export interface PostedContent {
  id: string;
  title: string;
  platform: "instagram" | "tiktok" | "twitter" | "linkedin";
  type: "video" | "image" | "carousel" | "text";
  postedAt: string;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number;
  performanceVsAvg: "above" | "average" | "below";
}

export const mockPostedContent: Record<string, PostedContent[]> = {
  gruve: [
    { id: "pc1", title: "Gruve NYE 2025 recap reel", platform: "instagram", type: "video", postedAt: "Apr 7", reach: 4200, impressions: 5800, likes: 342, comments: 28, shares: 45, saves: 67, engagementRate: 8.4, performanceVsAvg: "above" },
    { id: "pc2", title: "Behind the scenes: Sound check", platform: "tiktok", type: "video", postedAt: "Apr 5", reach: 2800, impressions: 4100, likes: 289, comments: 31, shares: 52, saves: 0, engagementRate: 12.1, performanceVsAvg: "above" },
    { id: "pc3", title: "Artist lineup announcement", platform: "instagram", type: "carousel", postedAt: "Apr 3", reach: 3100, impressions: 4500, likes: 198, comments: 42, shares: 23, saves: 89, engagementRate: 6.2, performanceVsAvg: "average" },
    { id: "pc4", title: "Ticket giveaway thread", platform: "twitter", type: "text", postedAt: "Apr 1", reach: 1900, impressions: 2800, likes: 67, comments: 34, shares: 89, saves: 0, engagementRate: 4.8, performanceVsAvg: "average" },
    { id: "pc5", title: "Early bird reminder story", platform: "instagram", type: "image", postedAt: "Mar 30", reach: 1200, impressions: 1800, likes: 89, comments: 5, shares: 3, saves: 12, engagementRate: 2.1, performanceVsAvg: "below" },
    { id: "pc6", title: "Venue tour walkthrough", platform: "tiktok", type: "video", postedAt: "Mar 28", reach: 1800, impressions: 2600, likes: 156, comments: 18, shares: 28, saves: 0, engagementRate: 7.8, performanceVsAvg: "average" },
    { id: "pc7", title: "Community spotlight: DJ set", platform: "instagram", type: "video", postedAt: "Mar 26", reach: 2400, impressions: 3200, likes: 234, comments: 15, shares: 32, saves: 41, engagementRate: 9.2, performanceVsAvg: "above" },
  ],
  sippy: [
    { id: "pc8", title: "Saturday launch party highlights", platform: "instagram", type: "video", postedAt: "Apr 12", reach: 3800, impressions: 5200, likes: 412, comments: 38, shares: 56, saves: 78, engagementRate: 11.2, performanceVsAvg: "above" },
    { id: "pc9", title: "Signature cocktail reveal", platform: "tiktok", type: "video", postedAt: "Apr 10", reach: 12000, impressions: 18500, likes: 1450, comments: 89, shares: 234, saves: 0, engagementRate: 14.5, performanceVsAvg: "above" },
    { id: "pc10", title: "Venue tour walkthrough", platform: "instagram", type: "carousel", postedAt: "Apr 8", reach: 2100, impressions: 3200, likes: 167, comments: 22, shares: 15, saves: 45, engagementRate: 7.8, performanceVsAvg: "average" },
    { id: "pc11", title: "Menu spotlight: Drink of the week", platform: "instagram", type: "image", postedAt: "Apr 5", reach: 1400, impressions: 2100, likes: 98, comments: 12, shares: 8, saves: 34, engagementRate: 5.4, performanceVsAvg: "average" },
  ],
};

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
