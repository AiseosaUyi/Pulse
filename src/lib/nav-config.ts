import { featureForPath, type FeatureKey } from "@/lib/features/registry";

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

// Four jobs, nothing else: Home, Leads, Content, Insights (Settings lives in
// the workspace menu). Each job is one sidebar row that opens to its tools.
// Tools a workspace switched off (src/lib/features) or a persona can't use
// are pruned; a job left with one tool shows as a plain link to it, and a job
// with none disappears. Nothing here deletes a page: every URL still works.
export const navGroups: NavGroup[] = [
  {
    label: "",
    items: [
      {
        label: "Home",
        href: "/dashboard",
        iconName: "LayoutDashboard",
        children: [
          { label: "Home", href: "/dashboard", iconName: "LayoutDashboard" },
          { label: "Tasks", href: "/tasks", iconName: "CheckSquare" },
        ],
      },
      {
        label: "Leads",
        href: "/leads",
        iconName: "Target",
        children: [
          { label: "Leads", href: "/leads", iconName: "Target", surfaces: ["startup"] },
          { label: "Email autopilot", href: "/autopilot", iconName: "Send", surfaces: ["startup"] },
          { label: "Conversations", href: "/conversations", iconName: "MessagesSquare" },
        ],
      },
      {
        label: "Content",
        href: "/composer",
        iconName: "PenLine",
        children: [
          { label: "Composer", href: "/composer", iconName: "PenLine" },
          { label: "Calendar & briefs", href: "/ai-content", iconName: "CalendarClock", surfaces: ["startup"] },
          { label: "Topic calendar", href: "/content-calendar", iconName: "CalendarCheck", surfaces: ["individual"] },
          { label: "Content vault", href: "/content-vault", iconName: "FolderOpen", surfaces: ["startup"] },
          { label: "SEO and blog", href: "/seo-tracker", iconName: "Search", surfaces: ["startup"] },
          { label: "Video", href: "/video", iconName: "Film", surfaces: ["startup"] },
          { label: "Schedule", href: "/schedule", iconName: "CalendarClock", surfaces: ["individual"] },
          { label: "Broadcasts", href: "/broadcasts", iconName: "Radio", surfaces: ["startup"] },
          { label: "Post history", href: "/post-history", iconName: "Clock" },
        ],
      },
      {
        label: "Insights",
        href: "/own-analytics",
        iconName: "BarChart3",
        children: [
          { label: "Analytics", href: "/own-analytics", iconName: "BarChart3", surfaces: ["startup"] },
          { label: "Competitor intel", href: "/intel-feed", iconName: "Zap" },
          { label: "Platform score", href: "/platform-score", iconName: "CircleDot" },
          { label: "Ads", href: "/ads-tracker", iconName: "Diamond", surfaces: ["startup"] },
        ],
      },
    ],
  },
];

/**
 * Keep the items `keep` allows. Children are filtered too; a parent left with
 * one child becomes a plain link to that child,
 * a parent left with none is dropped, and so is an empty group.
 */
export function pruneNav(groups: NavGroup[], keep: (item: NavItem) => boolean): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item): NavItem[] => {
        if (!keep(item)) return [];
        if (!item.children) return [item];
        const children = item.children.filter(keep);
        if (children.length === 0) return [];
        if (children.length === 1) {
          const { label, href, iconName } = children[0];
          return [{ label, href, iconName }];
        }
        return [{ ...item, href: children[0].href, children }];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** True when an item is visible to the given account type (no surfaces = all). */
export function isItemVisible(item: NavItem, accountType: NavAccountType): boolean {
  return !item.surfaces || item.surfaces.includes(accountType);
}

/** Curate the nav for a persona. */
export function navGroupsForAccountType(accountType: NavAccountType): NavGroup[] {
  return pruneNav(navGroups, (item) => isItemVisible(item, accountType));
}

/**
 * Drop tools owned by a feature this workspace switched off (see
 * src/lib/features/registry.ts). Hidden, not deleted: the page and its data
 * are still there and come back when the feature is switched on.
 */
export function navGroupsForFeatures(
  groups: NavGroup[],
  features: Partial<Record<FeatureKey, boolean>> | undefined
): NavGroup[] {
  if (!features) return groups;
  return pruneNav(groups, (item) => {
    if (item.children) return true;
    const key = featureForPath(item.href);
    return !key || features[key] !== false;
  });
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
  return pruneNav(groups, (item) => Boolean(item.children) || SUPPORT_VISIBLE_HREFS.has(item.href));
}
