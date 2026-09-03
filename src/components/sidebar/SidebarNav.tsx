import type { ReactNode } from "react";
import { SidebarNavGroup } from "./SidebarNavGroup";
import { navGroupsForAccountType, navGroupsForRole, type NavAccountType, type NavRole } from "@/lib/nav-config";

export function SidebarNav({
  accountType,
  role = "member",
  badges,
}: {
  accountType: NavAccountType;
  role?: NavRole;
  /** Live-computed badges keyed by nav item href — a server component
   * (e.g. ActionQueueBadge) passed down as a plain ReactNode, same
   * pattern as NeedsYouBadge but attached to a specific row instead of
   * rendered as its own block. */
  badges?: Record<string, ReactNode>;
}) {
  const groups = navGroupsForRole(navGroupsForAccountType(accountType), role);
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3">
      {groups.map((group, index) => (
        <SidebarNavGroup key={group.label || index} group={group} badges={badges} />
      ))}
    </nav>
  );
}
