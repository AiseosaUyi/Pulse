export type NavAccountType = "startup" | "individual";

export interface NavItem {
  label: string;
  href: string;
  iconName: string;
  children?: NavItem[];
  /**
   * Personas this item is shown to. Omitted = shown to ALL account types.
   */
  surfaces?: NavAccountType[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Nav groups = user jobs-to-be-done, not feature buckets.
// The loop is: Home → Discover → Create → Publish → Measure → Connect.
// Every item answers: "What am I doing right now?"
export const navGroups: NavGroup[] = [
  {
    // The daily starting point: AI coaching + at-a-glance health.
    label: "Home",
    items: [
      { label: "Dashboard", href: "/dashboard", iconName: "LayoutDashboard" },
      { label: "Analytics", href: "/own-analytics", iconName: "BarChart3", surfaces: ["startup"] },
    ],
  },
  {
    // What's happening in the market? Find angles before writing.
    // Intel flow: signal here → "Steal This →" goes straight to Composer.
    label: "Discover",
    items: [
      { label: "Intel feed", href: "/intel-feed", iconName: "Eye" },
      { label: "Viral trends", href: "/viral-trends", iconName: "TrendingUp" },
      { label: "SEO", href: "/seo-tracker", iconName: "Search", surfaces: ["startup"] },
    ],
  },
  {
    // Draft, plan, and generate content.
    // Composer is available to ALL — startup users write quick posts too.
    label: "Create",
    items: [
      { label: "Composer", href: "/composer", iconName: "PenLine" },
      {
        label: "AI Calendar",
        href: "/ai-content",
        iconName: "Sparkles",
        surfaces: ["startup"],
        children: [
          { label: "Calendar & briefs", href: "/ai-content", iconName: "CalendarClock" },
          { label: "Content vault", href: "/content-vault", iconName: "FolderOpen" },
        ],
      },
      { label: "Video studio", href: "/video", iconName: "Film", surfaces: ["startup"] },
    ],
  },
  {
    // Get it out the door.
    label: "Publish",
    items: [
      { label: "Today", href: "/today", iconName: "CalendarCheck", surfaces: ["individual"] },
      { label: "Schedule", href: "/schedule", iconName: "CalendarClock", surfaces: ["individual"] },
      { label: "Broadcasts", href: "/broadcasts", iconName: "Radio", surfaces: ["startup"] },
      { label: "Post history", href: "/post-history", iconName: "Clock" },
    ],
  },
  {
    // How is it working? Scores, rankings, engagement numbers.
    label: "Measure",
    items: [
      { label: "Platform score", href: "/platform-score", iconName: "CircleDot" },
      { label: "Ads critic", href: "/ads-tracker", iconName: "Diamond", surfaces: ["startup"] },
      { label: "Orders", href: "/orders", iconName: "ShoppingCart", surfaces: ["startup"] },
    ],
  },
  {
    // Two-way: respond, reach out, broadcast.
    label: "Connect",
    items: [
      { label: "Engage", href: "/engage", iconName: "MessagesSquare", surfaces: ["individual"] },
      { label: "Inbox", href: "/engagement", iconName: "MessageCircle", surfaces: ["startup"] },
      { label: "Outbound", href: "/leads", iconName: "Target", surfaces: ["startup"] },
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
