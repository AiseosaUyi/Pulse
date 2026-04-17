// ─── Platform Score ───────────────────────────────────────────

export interface PlatformScore {
  platform: string;
  score: number;
  maxScore: number;
  breakdown: { label: string; score: number; max: number }[];
  trend: "up" | "down" | "stable";
}

export const mockPlatformScores: Record<string, { overall: number; platforms: PlatformScore[] }> = {
  gruve: {
    overall: 64,
    platforms: [
      {
        platform: "Instagram",
        score: 78,
        maxScore: 100,
        breakdown: [
          { label: "Post frequency", score: 7, max: 10 },
          { label: "Engagement rate", score: 8, max: 10 },
          { label: "Follower growth", score: 6, max: 10 },
          { label: "Story activity", score: 9, max: 10 },
          { label: "Reel performance", score: 5, max: 10 },
        ],
        trend: "up",
      },
      {
        platform: "TikTok",
        score: 42,
        maxScore: 100,
        breakdown: [
          { label: "Post frequency", score: 2, max: 10 },
          { label: "Engagement rate", score: 8, max: 10 },
          { label: "Follower growth", score: 5, max: 10 },
          { label: "Video completion", score: 6, max: 10 },
          { label: "Trend adoption", score: 3, max: 10 },
        ],
        trend: "down",
      },
      {
        platform: "Twitter/X",
        score: 35,
        maxScore: 100,
        breakdown: [
          { label: "Tweet frequency", score: 2, max: 10 },
          { label: "Engagement rate", score: 3, max: 10 },
          { label: "Follower growth", score: 2, max: 10 },
          { label: "Reply rate", score: 4, max: 10 },
          { label: "Retweet ratio", score: 3, max: 10 },
        ],
        trend: "down",
      },
      {
        platform: "LinkedIn",
        score: 61,
        maxScore: 100,
        breakdown: [
          { label: "Post frequency", score: 5, max: 10 },
          { label: "Engagement rate", score: 7, max: 10 },
          { label: "Connection growth", score: 6, max: 10 },
          { label: "Article shares", score: 4, max: 10 },
          { label: "Profile views", score: 8, max: 10 },
        ],
        trend: "stable",
      },
    ],
  },
  sippy: {
    overall: 72,
    platforms: [
      {
        platform: "Instagram",
        score: 85,
        maxScore: 100,
        breakdown: [
          { label: "Post frequency", score: 9, max: 10 },
          { label: "Engagement rate", score: 8, max: 10 },
          { label: "Follower growth", score: 8, max: 10 },
          { label: "Story activity", score: 9, max: 10 },
          { label: "Reel performance", score: 7, max: 10 },
        ],
        trend: "up",
      },
      {
        platform: "TikTok",
        score: 71,
        maxScore: 100,
        breakdown: [
          { label: "Post frequency", score: 7, max: 10 },
          { label: "Engagement rate", score: 9, max: 10 },
          { label: "Follower growth", score: 6, max: 10 },
          { label: "Video completion", score: 7, max: 10 },
          { label: "Trend adoption", score: 6, max: 10 },
        ],
        trend: "up",
      },
    ],
  },
};

// ─── Viral Trends ─────────────────────────────────────────────

export interface TrendingHashtag {
  tag: string;
  posts: number;
  growth: string;
  relevance: "high" | "medium" | "low";
}

export interface TopContent {
  title: string;
  platform: string;
  reach: string;
  engagement: string;
  type: "video" | "image" | "carousel" | "text";
  date: string;
}

export const mockTrends: Record<string, { hashtags: TrendingHashtag[]; topContent: TopContent[] }> = {
  gruve: {
    hashtags: [
      { tag: "#EventsInLagos", posts: 12400, growth: "+34%", relevance: "high" },
      { tag: "#NaijaEvents", posts: 8900, growth: "+22%", relevance: "high" },
      { tag: "#LiveMusic", posts: 45000, growth: "+12%", relevance: "medium" },
      { tag: "#WeekendVibes", posts: 89000, growth: "+8%", relevance: "medium" },
      { tag: "#EventTicketing", posts: 3200, growth: "+45%", relevance: "high" },
      { tag: "#AfrobeatsLive", posts: 6700, growth: "+28%", relevance: "high" },
    ],
    topContent: [
      { title: "Gruve NYE 2025 recap reel", platform: "Instagram", reach: "4.2K", engagement: "8.4%", type: "video", date: "Apr 7" },
      { title: "Behind the scenes: Sound check", platform: "TikTok", reach: "2.8K", engagement: "12.1%", type: "video", date: "Apr 5" },
      { title: "Artist lineup announcement", platform: "Instagram", reach: "3.1K", engagement: "6.2%", type: "carousel", date: "Apr 3" },
      { title: "Ticket giveaway thread", platform: "Twitter/X", reach: "1.9K", engagement: "4.8%", type: "text", date: "Apr 1" },
    ],
  },
  sippy: {
    hashtags: [
      { tag: "#LagosNightlife", posts: 18200, growth: "+41%", relevance: "high" },
      { tag: "#SippyVibes", posts: 450, growth: "+120%", relevance: "high" },
      { tag: "#CocktailsOfLagos", posts: 3400, growth: "+18%", relevance: "medium" },
      { tag: "#WeekendInLagos", posts: 22000, growth: "+15%", relevance: "medium" },
    ],
    topContent: [
      { title: "Saturday launch party highlights", platform: "Instagram", reach: "3.8K", engagement: "11.2%", type: "video", date: "Apr 12" },
      { title: "Signature cocktail reveal", platform: "TikTok", reach: "12K", engagement: "14.5%", type: "video", date: "Apr 10" },
      { title: "Venue tour walkthrough", platform: "Instagram", reach: "2.1K", engagement: "7.8%", type: "carousel", date: "Apr 8" },
    ],
  },
};

// ─── AI Content Engine ────────────────────────────────────────

export interface ContentSuggestion {
  id: string;
  platform: string;
  type: "video" | "image" | "carousel" | "text";
  caption: string;
  bestTime: string;
  estimatedReach: string;
  status: "draft" | "scheduled" | "posted";
}

export interface CalendarDay {
  date: string;
  dayLabel: string;
  posts: { platform: string; status: "scheduled" | "draft" | "posted" }[];
}

export const mockContentSuggestions: Record<string, ContentSuggestion[]> = {
  gruve: [
    { id: "c1", platform: "Instagram", type: "video", caption: "Event highlight reel from last weekend's show — 30s with trending audio", bestTime: "Tue 6:00 PM", estimatedReach: "3.5K-5K", status: "draft" },
    { id: "c2", platform: "TikTok", type: "video", caption: "POV: You just got your Gruve ticket — reaction trend", bestTime: "Wed 8:00 PM", estimatedReach: "2K-8K", status: "draft" },
    { id: "c3", platform: "Instagram", type: "carousel", caption: "5 reasons to attend Gruve Live this month — swipeable tips", bestTime: "Thu 12:00 PM", estimatedReach: "2K-3K", status: "scheduled" },
    { id: "c4", platform: "Twitter/X", type: "text", caption: "We just dropped 50 early bird tickets. Gone in 2 hours last time. Link in bio.", bestTime: "Fri 10:00 AM", estimatedReach: "800-1.5K", status: "draft" },
    { id: "c5", platform: "LinkedIn", type: "text", caption: "How we grew event attendance 40% through community-led marketing — thread", bestTime: "Mon 9:00 AM", estimatedReach: "500-1K", status: "draft" },
  ],
  sippy: [
    { id: "c6", platform: "Instagram", type: "video", caption: "Saturday night at Sippy — ambiance reel with lo-fi beat", bestTime: "Sat 7:00 PM", estimatedReach: "4K-6K", status: "draft" },
    { id: "c7", platform: "TikTok", type: "video", caption: "Making the Sippy Sunset cocktail — recipe trend format", bestTime: "Thu 6:00 PM", estimatedReach: "5K-15K", status: "scheduled" },
    { id: "c8", platform: "Instagram", type: "image", caption: "Menu spotlight: New drink of the week with lifestyle shot", bestTime: "Wed 12:00 PM", estimatedReach: "1.5K-2.5K", status: "draft" },
  ],
};

export const mockCalendar: Record<string, CalendarDay[]> = {
  gruve: [
    { date: "Apr 14", dayLabel: "Mon", posts: [{ platform: "LinkedIn", status: "scheduled" }] },
    { date: "Apr 15", dayLabel: "Tue", posts: [{ platform: "Instagram", status: "draft" }] },
    { date: "Apr 16", dayLabel: "Wed", posts: [{ platform: "TikTok", status: "draft" }] },
    { date: "Apr 17", dayLabel: "Thu", posts: [{ platform: "Instagram", status: "scheduled" }] },
    { date: "Apr 18", dayLabel: "Fri", posts: [{ platform: "Twitter/X", status: "draft" }] },
    { date: "Apr 19", dayLabel: "Sat", posts: [] },
    { date: "Apr 20", dayLabel: "Sun", posts: [] },
  ],
  sippy: [
    { date: "Apr 14", dayLabel: "Mon", posts: [] },
    { date: "Apr 15", dayLabel: "Tue", posts: [] },
    { date: "Apr 16", dayLabel: "Wed", posts: [{ platform: "Instagram", status: "draft" }] },
    { date: "Apr 17", dayLabel: "Thu", posts: [{ platform: "TikTok", status: "scheduled" }] },
    { date: "Apr 18", dayLabel: "Fri", posts: [] },
    { date: "Apr 19", dayLabel: "Sat", posts: [{ platform: "Instagram", status: "draft" }] },
    { date: "Apr 20", dayLabel: "Sun", posts: [] },
  ],
};

