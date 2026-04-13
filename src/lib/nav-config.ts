export interface NavItem {
  label: string;
  href: string;
  iconName: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "OVERVIEW",
    items: [
      { label: "Dashboard", href: "/dashboard", iconName: "LayoutDashboard" },
    ],
  },
  {
    label: "CONTENT",
    items: [
      { label: "Content vault", href: "/content-vault", iconName: "FolderOpen" },
      { label: "AI content engine", href: "/ai-content", iconName: "Sparkles" },
    ],
  },
  {
    label: "SOCIAL",
    items: [
      { label: "Engagement inbox", href: "/engagement", iconName: "MessageCircle" },
      { label: "Platform score", href: "/platform-score", iconName: "CircleDot" },
      { label: "Viral trends", href: "/viral-trends", iconName: "TrendingUp" },
      { label: "Post history", href: "/post-history", iconName: "Clock" },
    ],
  },
  {
    label: "GROWTH",
    items: [
      { label: "Leads & outreach", href: "/leads", iconName: "Target" },
      { label: "Ads tracker", href: "/ads-tracker", iconName: "Diamond" },
    ],
  },
  {
    label: "SEO & DISCOVERY",
    items: [
      { label: "SEO command center", href: "/seo-tracker", iconName: "Search" },
      { label: "Competition", href: "/competition", iconName: "Radio" },
    ],
  },
];
