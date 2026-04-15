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
    ],
  },
  {
    label: "SOCIAL",
    items: [
      {
        label: "Content",
        href: "/content-vault",
        iconName: "FolderOpen",
        children: [
          { label: "Vault", href: "/content-vault", iconName: "FolderOpen" },
          { label: "AI content engine", href: "/ai-content", iconName: "Sparkles" },
        ],
      },
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
    label: "INTELLIGENCE",
    items: [
      {
        label: "Intel feed",
        href: "/intel-feed",
        iconName: "Eye",
        children: [
          { label: "Feed", href: "/intel-feed", iconName: "Eye" },
          { label: "Content briefs", href: "/content-briefs", iconName: "FileText" },
        ],
      },
      { label: "SEO command center", href: "/seo-tracker", iconName: "Search" },
    ],
  },
];
