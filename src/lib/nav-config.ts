export type NavAccountType = "startup" | "individual";

export interface NavItem {
  label: string;
  href: string;
  iconName: string;
  children?: NavItem[];
  /**
   * Personas this item is shown to. Omitted = shown to ALL account types.
   * Composer/Today are individual-only; the B2B marketing surfaces are
   * startup-only; broadly-useful tools (video, trends, post history) are shared.
   */
  surfaces?: NavAccountType[];
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
      { label: "Own analytics", href: "/own-analytics", iconName: "BarChart3", surfaces: ["startup"] },
    ],
  },
  {
    label: "SOCIAL",
    items: [
      { label: "Composer", href: "/composer", iconName: "PenLine", surfaces: ["individual"] },
      { label: "Schedule", href: "/schedule", iconName: "CalendarClock", surfaces: ["individual"] },
      { label: "Engage", href: "/engage", iconName: "MessagesSquare", surfaces: ["individual"] },
      { label: "Today", href: "/today", iconName: "CalendarCheck", surfaces: ["individual"] },
      {
        label: "Content",
        href: "/ai-content",
        iconName: "FolderOpen",
        surfaces: ["startup"],
        children: [
          { label: "Calendar & briefs", href: "/ai-content", iconName: "Sparkles" },
          { label: "Vault", href: "/content-vault", iconName: "FolderOpen" },
        ],
      },
      { label: "Engagement inbox", href: "/engagement", iconName: "MessageCircle", surfaces: ["startup"] },
      { label: "Broadcasts", href: "/broadcasts", iconName: "Radio", surfaces: ["startup"] },
      { label: "Video studio", href: "/video", iconName: "Film", surfaces: ["startup"] },
      { label: "Platform score", href: "/platform-score", iconName: "CircleDot" },
      { label: "Viral trends", href: "/viral-trends", iconName: "TrendingUp" },
      { label: "Post history", href: "/post-history", iconName: "Clock" },
    ],
  },
  {
    label: "GROWTH",
    items: [
      { label: "Outbound", href: "/leads", iconName: "Target", surfaces: ["startup"] },
      { label: "Orders", href: "/orders", iconName: "ShoppingCart", surfaces: ["startup"] },
      { label: "Ads critic", href: "/ads-tracker", iconName: "Diamond", surfaces: ["startup"] },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { label: "Intel feed", href: "/intel-feed", iconName: "Eye", surfaces: ["startup"] },
      { label: "SEO command center", href: "/seo-tracker", iconName: "Search", surfaces: ["startup"] },
    ],
  },
];

/** True when an item is visible to the given account type (no surfaces = all). */
export function isItemVisible(item: NavItem, accountType: NavAccountType): boolean {
  return !item.surfaces || item.surfaces.includes(accountType);
}

/** Curate the nav for a persona: drop hidden items and any group left empty. */
export function navGroupsForAccountType(accountType: NavAccountType): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isItemVisible(item, accountType)),
    }))
    .filter((group) => group.items.length > 0);
}
