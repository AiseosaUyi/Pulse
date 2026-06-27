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
    // Signals = Intel feed + Viral trends merged. Manual "Add a trend" lives inside Signals.
    label: "Discover",
    items: [
      { label: "Signals", href: "/intel-feed", iconName: "Zap" },
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
    // Two-way: respond, reach out.
    // Conversations merges Engage (individual) + Engagement Inbox (startup) into one surface.
    label: "Connect",
    items: [
      { label: "Conversations", href: "/conversations", iconName: "MessagesSquare" },
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
