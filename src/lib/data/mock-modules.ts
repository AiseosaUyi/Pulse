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

// ─── Leads & Outreach ─────────────────────────────────────────

export interface Lead {
  id: string;
  name: string;
  company: string;
  type: "venue" | "sponsor" | "partner" | "influencer" | "media";
  status: "new" | "contacted" | "warm" | "cold" | "converted";
  lastContact: string;
  nextAction: string;
  value: string;
}

export const mockLeads: Record<string, Lead[]> = {
  gruve: [
    { id: "l1", name: "Tunde Adeyemi", company: "Muse Events", type: "partner", status: "warm", lastContact: "Apr 8", nextAction: "Follow up on co-hosting proposal", value: "High" },
    { id: "l2", name: "Amara Obi", company: "Party Lagos", type: "partner", status: "cold", lastContact: "Mar 22", nextAction: "Re-engage with new event concept", value: "High" },
    { id: "l3", name: "DJ Spinall's Manager", company: "Afrorave Crew", type: "influencer", status: "cold", lastContact: "Mar 15", nextAction: "Send updated partnership deck", value: "Very High" },
    { id: "l4", name: "Bola Fashola", company: "GTBank Events", type: "sponsor", status: "contacted", lastContact: "Apr 10", nextAction: "Awaiting budget approval", value: "Very High" },
    { id: "l5", name: "Kemi Alade", company: "BeatFM Lagos", type: "media", status: "warm", lastContact: "Apr 6", nextAction: "Confirm interview slot for next event", value: "Medium" },
    { id: "l6", name: "Chidi Nwosu", company: "Eko Atlantic Venues", type: "venue", status: "new", lastContact: "Apr 12", nextAction: "Schedule venue walkthrough", value: "High" },
    { id: "l7", name: "Sade Williams", company: "Pulse Nigeria", type: "media", status: "converted", lastContact: "Apr 11", nextAction: "Send event press kit", value: "Medium" },
  ],
  sippy: [
    { id: "l8", name: "Femi Johnson", company: "Lagos Eats", type: "media", status: "warm", lastContact: "Apr 9", nextAction: "Arrange tasting session for review", value: "Medium" },
    { id: "l9", name: "Ada Nnamdi", company: "Mixology NG", type: "influencer", status: "contacted", lastContact: "Apr 11", nextAction: "Confirm collab on cocktail content", value: "High" },
    { id: "l10", name: "Uche Daniels", company: "Island Block Party", type: "partner", status: "new", lastContact: "Apr 13", nextAction: "Discuss pop-up bar opportunity", value: "High" },
    { id: "l11", name: "Grace Ojo", company: "Heineken Nigeria", type: "sponsor", status: "warm", lastContact: "Apr 7", nextAction: "Send sponsorship proposal", value: "Very High" },
  ],
};

// ─── Ads Tracker ──────────────────────────────────────────────

export interface AdCampaign {
  id: string;
  name: string;
  platform: string;
  status: "active" | "paused" | "completed" | "draft";
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpc: number;
  roas: number;
  costPerConversion: number;
  startDate: string;
  endDate: string;
}

export const mockCampaigns: Record<string, AdCampaign[]> = {
  gruve: [
    { id: "a1", name: "Gruve Live April — Awareness", platform: "Instagram", status: "paused", spend: 35000, revenue: 178000, impressions: 45200, clicks: 1230, conversions: 89, cpc: 28.46, roas: 5.09, costPerConversion: 393, startDate: "Mar 15", endDate: "Apr 1" },
    { id: "a2", name: "Ticket Sales Push", platform: "Instagram", status: "paused", spend: 22000, revenue: 312000, impressions: 28400, clicks: 890, conversions: 156, cpc: 24.72, roas: 14.18, costPerConversion: 141, startDate: "Mar 25", endDate: "Apr 5" },
    { id: "a3", name: "TikTok Event Teaser", platform: "TikTok", status: "completed", spend: 15000, revenue: 67500, impressions: 62000, clicks: 2100, conversions: 45, cpc: 7.14, roas: 4.50, costPerConversion: 333, startDate: "Mar 10", endDate: "Mar 30" },
  ],
  sippy: [
    { id: "a4", name: "Grand Opening Awareness", platform: "Instagram", status: "active", spend: 25000, revenue: 85000, impressions: 38000, clicks: 1450, conversions: 210, cpc: 17.24, roas: 3.40, costPerConversion: 119, startDate: "Apr 5", endDate: "Apr 20" },
    { id: "a5", name: "Cocktail Hour Promo", platform: "Instagram", status: "active", spend: 20000, revenue: 42000, impressions: 22000, clicks: 980, conversions: 85, cpc: 20.41, roas: 2.10, costPerConversion: 235, startDate: "Apr 8", endDate: "Apr 22" },
    { id: "a6", name: "Weekend Vibes TikTok", platform: "TikTok", status: "draft", spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0, cpc: 0, roas: 0, costPerConversion: 0, startDate: "Apr 15", endDate: "Apr 30" },
  ],
};

// ─── SEO Tracker ──────────────────────────────────────────────

export interface KeywordRanking {
  keyword: string;
  position: number;
  previousPosition: number;
  volume: number;
  difficulty: "easy" | "medium" | "hard";
  url: string;
}

export interface SEOMetric {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down" | "stable";
}

export const mockKeywords: Record<string, KeywordRanking[]> = {
  gruve: [
    { keyword: "event ticketing Nigeria", position: 11, previousPosition: 15, volume: 2400, difficulty: "medium", url: "/events" },
    { keyword: "buy event tickets Lagos", position: 8, previousPosition: 9, volume: 1800, difficulty: "medium", url: "/events/lagos" },
    { keyword: "Gruve events", position: 1, previousPosition: 1, volume: 890, difficulty: "easy", url: "/" },
    { keyword: "live music events Lagos", position: 18, previousPosition: 22, volume: 3200, difficulty: "hard", url: "/events/music" },
    { keyword: "event ticketing platform Africa", position: 14, previousPosition: 19, volume: 1200, difficulty: "hard", url: "/" },
    { keyword: "concert tickets Nigeria", position: 23, previousPosition: 28, volume: 4100, difficulty: "hard", url: "/events/concerts" },
    { keyword: "weekend events near me", position: 31, previousPosition: 35, volume: 8900, difficulty: "hard", url: "/events" },
  ],
  sippy: [
    { keyword: "best bars Lagos", position: 15, previousPosition: 22, volume: 5400, difficulty: "hard", url: "/" },
    { keyword: "cocktail bar Lagos", position: 9, previousPosition: 12, volume: 2200, difficulty: "medium", url: "/" },
    { keyword: "Sippy Lagos", position: 1, previousPosition: 1, volume: 320, difficulty: "easy", url: "/" },
    { keyword: "nightlife Lagos Island", position: 19, previousPosition: 25, volume: 3800, difficulty: "hard", url: "/events" },
    { keyword: "best cocktails Calabar", position: 5, previousPosition: 8, volume: 480, difficulty: "easy", url: "/calabar" },
  ],
};

export const mockSEOMetrics: Record<string, SEOMetric[]> = {
  gruve: [
    { label: "Domain Authority", value: "28", change: "+3", direction: "up" },
    { label: "Indexed Pages", value: "142", change: "+12", direction: "up" },
    { label: "Backlinks", value: "89", change: "+7", direction: "up" },
    { label: "Avg. Position", value: "15.1", change: "-2.4", direction: "up" },
  ],
  sippy: [
    { label: "Domain Authority", value: "18", change: "+5", direction: "up" },
    { label: "Indexed Pages", value: "34", change: "+8", direction: "up" },
    { label: "Backlinks", value: "23", change: "+11", direction: "up" },
    { label: "Avg. Position", value: "9.8", change: "-3.2", direction: "up" },
  ],
};

// ─── Competition ──────────────────────────────────────────────

export interface Competitor {
  name: string;
  website: string;
  platforms: { name: string; followers: number; engagement: string }[];
  strengths: string[];
  weaknesses: string[];
  threatLevel: "high" | "medium" | "low";
}

export const mockCompetitors: Record<string, Competitor[]> = {
  gruve: [
    {
      name: "Tix Africa",
      website: "tix.africa",
      platforms: [
        { name: "Instagram", followers: 15200, engagement: "2.8%" },
        { name: "Twitter/X", followers: 8900, engagement: "1.5%" },
      ],
      strengths: ["Established brand", "Multi-city presence", "Developer API"],
      weaknesses: ["Generic positioning", "Low social engagement", "No TikTok presence"],
      threatLevel: "high",
    },
    {
      name: "Eventbrite NG",
      website: "eventbrite.com",
      platforms: [
        { name: "Instagram", followers: 45000, engagement: "0.8%" },
        { name: "Twitter/X", followers: 32000, engagement: "0.4%" },
      ],
      strengths: ["Global brand recognition", "Enterprise features", "SEO dominance"],
      weaknesses: ["Not Nigeria-focused", "High fees", "Poor local support"],
      threatLevel: "medium",
    },
    {
      name: "Nairabox",
      website: "nairabox.com",
      platforms: [
        { name: "Instagram", followers: 8400, engagement: "3.1%" },
        { name: "TikTok", followers: 2100, engagement: "5.2%" },
      ],
      strengths: ["Strong local brand", "Good mobile experience", "Naira-first pricing"],
      weaknesses: ["Limited event types", "Small team", "No LinkedIn presence"],
      threatLevel: "high",
    },
  ],
  sippy: [
    {
      name: "Bukka Hut",
      website: "bukkahut.com",
      platforms: [
        { name: "Instagram", followers: 28000, engagement: "2.2%" },
      ],
      strengths: ["Multiple locations", "Strong brand", "Food delivery integration"],
      weaknesses: ["Not nightlife-focused", "Low social engagement"],
      threatLevel: "low",
    },
    {
      name: "Hard Rock Lagos",
      website: "hardrockcafe.com",
      platforms: [
        { name: "Instagram", followers: 12000, engagement: "1.8%" },
      ],
      strengths: ["International brand", "Premium positioning", "Live music"],
      weaknesses: ["High prices", "Tourist-heavy", "Not community-driven"],
      threatLevel: "medium",
    },
    {
      name: "Sky Lounge",
      website: "skyloungelagos.com",
      platforms: [
        { name: "Instagram", followers: 9800, engagement: "4.5%" },
        { name: "TikTok", followers: 3200, engagement: "7.1%" },
      ],
      strengths: ["Strong social game", "Young audience", "Viral content"],
      weaknesses: ["Single location", "Weekend-only traffic"],
      threatLevel: "high",
    },
  ],
};
