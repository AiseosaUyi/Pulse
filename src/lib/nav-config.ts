export interface NavItem {
  label: string;
  href: string;
  iconName: string;
  children?: NavItem[];
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
      { label: "Own analytics", href: "/own-analytics", iconName: "BarChart3" },
    ],
  },
  {
    label: "SOCIAL",
    items: [
      {
        label: "Content",
        href: "/ai-content",
        iconName: "FolderOpen",
        children: [
          { label: "Calendar & briefs", href: "/ai-content", iconName: "Sparkles" },
          { label: "Vault", href: "/content-vault", iconName: "FolderOpen" },
        ],
      },
      { label: "Engagement inbox", href: "/engagement", iconName: "MessageCircle" },
      { label: "Broadcasts", href: "/broadcasts", iconName: "Radio" },
      { label: "Graphics", href: "/graphics", iconName: "Image" },
      { label: "Video studio", href: "/video", iconName: "Film" },
      { label: "Platform score", href: "/platform-score", iconName: "CircleDot" },
      { label: "Viral trends", href: "/viral-trends", iconName: "TrendingUp" },
      { label: "Post history", href: "/post-history", iconName: "Clock" },
    ],
  },
  {
    label: "GROWTH",
    items: [
      { label: "Outbound", href: "/leads", iconName: "Target" },
      { label: "Orders", href: "/orders", iconName: "ShoppingCart" },
      { label: "Ads critic", href: "/ads-tracker", iconName: "Diamond" },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { label: "Intel feed", href: "/intel-feed", iconName: "Eye" },
      { label: "SEO command center", href: "/seo-tracker", iconName: "Search" },
    ],
  },
];
