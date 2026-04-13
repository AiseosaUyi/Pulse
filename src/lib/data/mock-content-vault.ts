export interface SavedContent {
  id: string;
  title: string;
  sourceUrl: string;
  sourcePlatform: "tiktok" | "instagram" | "twitter" | "youtube" | "manual";
  type: "video" | "image" | "meme" | "carousel";
  thumbnailEmoji: string;
  duration?: string;
  watermarkRemoved: boolean;
  bestFor: ("instagram" | "tiktok" | "twitter" | "linkedin")[];
  savedAt: string;
  tags: string[];
  status: "saved" | "used" | "scheduled";
}

export interface TrendingContent {
  id: string;
  title: string;
  platform: string;
  category: string;
  viralScore: number;
  views: string;
  thumbnailEmoji: string;
  relevance: "high" | "medium" | "low";
  sampleUrl: string;
}

export const mockSavedContent: Record<string, SavedContent[]> = {
  gruve: [
    {
      id: "v1",
      title: "Concert crowd reaction - arms up moment",
      sourceUrl: "https://tiktok.com/@viralmoments/video/123",
      sourcePlatform: "tiktok",
      type: "video",
      thumbnailEmoji: "🎤",
      duration: "0:15",
      watermarkRemoved: true,
      bestFor: ["instagram", "tiktok"],
      savedAt: "Apr 12",
      tags: ["crowd", "energy", "concert"],
      status: "saved",
    },
    {
      id: "v2",
      title: "POV: You just got your ticket - reaction meme",
      sourceUrl: "https://tiktok.com/@memepage/video/456",
      sourcePlatform: "tiktok",
      type: "meme",
      thumbnailEmoji: "😱",
      duration: "0:08",
      watermarkRemoved: true,
      bestFor: ["tiktok", "instagram"],
      savedAt: "Apr 11",
      tags: ["reaction", "ticket", "excitement"],
      status: "used",
    },
    {
      id: "v3",
      title: "DJ transition compilation - smooth cuts",
      sourceUrl: "https://instagram.com/p/ABC123",
      sourcePlatform: "instagram",
      type: "video",
      thumbnailEmoji: "🎧",
      duration: "0:30",
      watermarkRemoved: true,
      bestFor: ["instagram", "tiktok", "twitter"],
      savedAt: "Apr 10",
      tags: ["dj", "music", "transition"],
      status: "saved",
    },
    {
      id: "v4",
      title: "Event setup timelapse template",
      sourceUrl: "https://tiktok.com/@eventpro/video/789",
      sourcePlatform: "tiktok",
      type: "video",
      thumbnailEmoji: "⏱",
      duration: "0:22",
      watermarkRemoved: true,
      bestFor: ["tiktok", "instagram"],
      savedAt: "Apr 9",
      tags: ["setup", "timelapse", "behind-scenes"],
      status: "saved",
    },
    {
      id: "v5",
      title: "\"Sold out\" announcement graphic template",
      sourceUrl: "",
      sourcePlatform: "manual",
      type: "image",
      thumbnailEmoji: "🔥",
      watermarkRemoved: false,
      bestFor: ["instagram", "twitter", "linkedin"],
      savedAt: "Apr 8",
      tags: ["announcement", "sold-out", "hype"],
      status: "scheduled",
    },
    {
      id: "v6",
      title: "Festival fashion trend compilation",
      sourceUrl: "https://tiktok.com/@fashiontrends/video/321",
      sourcePlatform: "tiktok",
      type: "video",
      thumbnailEmoji: "👗",
      duration: "0:45",
      watermarkRemoved: true,
      bestFor: ["tiktok", "instagram"],
      savedAt: "Apr 7",
      tags: ["fashion", "festival", "outfit"],
      status: "saved",
    },
  ],
  sippy: [
    {
      id: "v7",
      title: "Cocktail pour slow-mo - satisfying edit",
      sourceUrl: "https://tiktok.com/@mixology/video/111",
      sourcePlatform: "tiktok",
      type: "video",
      thumbnailEmoji: "🍸",
      duration: "0:12",
      watermarkRemoved: true,
      bestFor: ["instagram", "tiktok"],
      savedAt: "Apr 12",
      tags: ["cocktail", "slowmo", "satisfying"],
      status: "saved",
    },
    {
      id: "v8",
      title: "Bar ambiance reel with lo-fi music",
      sourceUrl: "https://instagram.com/p/DEF456",
      sourcePlatform: "instagram",
      type: "video",
      thumbnailEmoji: "🌙",
      duration: "0:20",
      watermarkRemoved: true,
      bestFor: ["instagram", "tiktok"],
      savedAt: "Apr 11",
      tags: ["ambiance", "nightlife", "lofi"],
      status: "used",
    },
    {
      id: "v9",
      title: "\"When the bartender knows your order\" meme",
      sourceUrl: "https://twitter.com/memes/status/999",
      sourcePlatform: "twitter",
      type: "meme",
      thumbnailEmoji: "😎",
      duration: "0:06",
      watermarkRemoved: true,
      bestFor: ["tiktok", "instagram", "twitter"],
      savedAt: "Apr 10",
      tags: ["meme", "bartender", "funny"],
      status: "saved",
    },
    {
      id: "v10",
      title: "Nightlife drone shot Lagos Island",
      sourceUrl: "https://youtube.com/watch?v=XYZ",
      sourcePlatform: "youtube",
      type: "video",
      thumbnailEmoji: "🏙",
      duration: "0:35",
      watermarkRemoved: true,
      bestFor: ["instagram", "tiktok", "linkedin"],
      savedAt: "Apr 9",
      tags: ["drone", "lagos", "cityscape"],
      status: "saved",
    },
  ],
};

export const mockTrendingContent: Record<string, TrendingContent[]> = {
  gruve: [
    { id: "t1", title: "\"I'm going to this event\" overlay trend", platform: "TikTok", category: "Events", viralScore: 92, views: "4.2M", thumbnailEmoji: "🎪", relevance: "high", sampleUrl: "https://tiktok.com/trending/1" },
    { id: "t2", title: "Concert crowd singing along format", platform: "TikTok", category: "Music", viralScore: 88, views: "2.8M", thumbnailEmoji: "🎶", relevance: "high", sampleUrl: "https://tiktok.com/trending/2" },
    { id: "t3", title: "Before/after event transformation", platform: "Instagram", category: "Events", viralScore: 85, views: "1.5M", thumbnailEmoji: "✨", relevance: "high", sampleUrl: "https://instagram.com/trending/3" },
    { id: "t4", title: "\"Tag someone you'd bring\" engagement bait", platform: "Instagram", category: "Engagement", viralScore: 78, views: "890K", thumbnailEmoji: "👥", relevance: "medium", sampleUrl: "https://instagram.com/trending/4" },
    { id: "t5", title: "DJ set first-person POV", platform: "TikTok", category: "Music", viralScore: 74, views: "1.1M", thumbnailEmoji: "🎛", relevance: "medium", sampleUrl: "https://tiktok.com/trending/5" },
    { id: "t6", title: "Ticket unboxing/reveal reaction", platform: "TikTok", category: "Events", viralScore: 71, views: "650K", thumbnailEmoji: "🎟", relevance: "high", sampleUrl: "https://tiktok.com/trending/6" },
  ],
  sippy: [
    { id: "t7", title: "ASMR cocktail making trend", platform: "TikTok", category: "Food & Drink", viralScore: 95, views: "6.1M", thumbnailEmoji: "🍹", relevance: "high", sampleUrl: "https://tiktok.com/trending/7" },
    { id: "t8", title: "\"Rate my order\" bar edition", platform: "TikTok", category: "Food & Drink", viralScore: 82, views: "2.2M", thumbnailEmoji: "⭐", relevance: "high", sampleUrl: "https://tiktok.com/trending/8" },
    { id: "t9", title: "Nightlife outfit transition reel", platform: "Instagram", category: "Lifestyle", viralScore: 79, views: "1.8M", thumbnailEmoji: "💃", relevance: "medium", sampleUrl: "https://instagram.com/trending/9" },
    { id: "t10", title: "\"POV: You walk into the best bar in Lagos\"", platform: "TikTok", category: "Nightlife", viralScore: 88, views: "3.4M", thumbnailEmoji: "🚪", relevance: "high", sampleUrl: "https://tiktok.com/trending/10" },
  ],
};
