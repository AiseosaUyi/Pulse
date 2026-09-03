export type NavAccountType = "startup" | "individual";

// Kept independent from auth.ts's TenantMembership["role"] the same way
// NavAccountType is kept independent from AccountType — this module stays a
// leaf with no cross-import into auth.ts.
export type NavRole = "owner" | "admin" | "member" | "support";

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
// Conversations/Outbound lead the list on purpose (not the original "Home →
// Discover → Create → Publish → Measure → Connect" job order): they're the
// tools that directly make money, and were previously the last group in a
// 6-group sidebar — the least visible items were the most important ones.
export const navGroups: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Dashboard", href: "/dashboard", iconName: "LayoutDashboard" },
      { label: "Analytics", href: "/own-analytics", iconName: "BarChart3", surfaces: ["startup"] },
    ],
  },
  {
    label: "",
    items: [
      { label: "Outbound", href: "/leads", iconName: "Target", surfaces: ["startup"] },
      { label: "Conversations", href: "/conversations", iconName: "MessagesSquare" },
    ],
  },
  {
    label: "",
    items: [
      { label: "Competitor intel", href: "/intel-feed", iconName: "Zap" },
      { label: "SEO", href: "/seo-tracker", iconName: "Search", surfaces: ["startup"] },
    ],
  },
  {
    label: "",
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
      // Individual-persona only — a startup tenant already has AI Calendar;
      // showing both at once (they're genuinely different implementations,
      // not the same feature twice) was confusing, not just redundant.
      { label: "Content calendar", href: "/content-calendar", iconName: "CalendarCheck", surfaces: ["individual"] },
    ],
  },
  {
    label: "",
    items: [
      { label: "Schedule", href: "/schedule", iconName: "CalendarClock", surfaces: ["individual"] },
      { label: "Broadcasts", href: "/broadcasts", iconName: "Radio", surfaces: ["startup"] },
      { label: "Post history", href: "/post-history", iconName: "Clock" },
    ],
  },
  {
    label: "",
    items: [
      { label: "Platform score", href: "/platform-score", iconName: "CircleDot" },
      { label: "Ads critic", href: "/ads-tracker", iconName: "Diamond", surfaces: ["startup"] },
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

// Hrefs a `support` member can reach — the Action Queue board (their daily
// work surface, migration 105) and the shared inbox. See navGroupsForRole.
const SUPPORT_VISIBLE_HREFS = new Set(["/dashboard", "/conversations"]);

/**
 * Second-pass curation applied AFTER navGroupsForAccountType(): a `support`
 * role is restricted to Dashboard + Conversations, regardless of persona.
 * This is a UI convenience — hiding a link a support agent couldn't use
 * anyway — not the actual security boundary. The real boundary is Postgres
 * RLS (migration 103's is_support_member() restrictive policies, and
 * migration 105's narrower kind-scoped restrictive policy on
 * action_items); this function has zero effect on what a support-role
 * member can read/write via a direct Supabase API call.
 */
export function navGroupsForRole(groups: NavGroup[], role: NavRole): NavGroup[] {
  if (role !== "support") return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => SUPPORT_VISIBLE_HREFS.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);
}
