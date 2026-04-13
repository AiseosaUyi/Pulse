import { DashboardStats, Suggestion } from "@/lib/types/dashboard";

export const mockDashboardStats: Record<string, DashboardStats> = {
  gruve: {
    socialReach: {
      label: "Social reach",
      value: "12.4K",
      subtitle: "",
      change: { value: "18% this week", direction: "up" },
    },
    profileScore: {
      label: "Profile score",
      value: "64",
      subtitle: "Room to improve",
    },
    activeLeads: {
      label: "Active leads",
      value: "7",
      subtitle: "3 need follow-up",
    },
    adSpend: {
      label: "Ad spend (MTD)",
      value: "0",
      subtitle: "Ads paused",
    },
  },
  sippy: {
    socialReach: {
      label: "Social reach",
      value: "3.5K",
      subtitle: "",
      change: { value: "24% this week", direction: "up" },
    },
    profileScore: {
      label: "Profile score",
      value: "72",
      subtitle: "Good momentum",
    },
    activeLeads: {
      label: "Active leads",
      value: "4",
      subtitle: "1 needs follow-up",
    },
    adSpend: {
      label: "Ad spend (MTD)",
      value: "45000",
      subtitle: "2 campaigns active",
    },
  },
};

export const mockSuggestions: Record<string, Suggestion[]> = {
  gruve: [
    {
      id: "s1",
      title: "Post an event highlight reel",
      description: "Video posts get 3x more reach on IG this week",
      impact: "high_impact",
      targetModule: "/ai-content",
    },
    {
      id: "s2",
      title: "Follow up with 3 warm leads",
      description: "Muse Events, Party Lagos, Afrorave crew — gone cold",
      impact: "urgent",
      targetModule: "/leads",
    },
    {
      id: "s3",
      title: "TikTok needs 2 posts this week",
      description: "Account is 11 days without content",
      impact: "overdue",
      targetModule: "/ai-content",
    },
    {
      id: "s4",
      title: "Target keyword #4 is close to page 1",
      description: '"event ticketing Nigeria" — 1 position away',
      impact: "opportunity",
      targetModule: "/seo-tracker",
    },
  ],
  sippy: [
    {
      id: "s5",
      title: "Share weekend event photos",
      description: "Fresh content from Saturday's launch — post today",
      impact: "high_impact",
      targetModule: "/ai-content",
    },
    {
      id: "s6",
      title: "Respond to 5 DM inquiries",
      description: "Instagram DMs from potential venue partners",
      impact: "urgent",
      targetModule: "/leads",
    },
    {
      id: "s7",
      title: "Boost top-performing reel",
      description: "Last reel hit 12K views organically — amplify it",
      impact: "opportunity",
      targetModule: "/ads-tracker",
    },
  ],
};
