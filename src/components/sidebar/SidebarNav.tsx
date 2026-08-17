import { SidebarNavGroup } from "./SidebarNavGroup";
import { navGroupsForAccountType, navGroupsForRole, type NavAccountType, type NavRole } from "@/lib/nav-config";

export function SidebarNav({
  accountType,
  role = "member",
}: {
  accountType: NavAccountType;
  role?: NavRole;
}) {
  const groups = navGroupsForRole(navGroupsForAccountType(accountType), role);
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3">
      {groups.map((group, index) => (
        <SidebarNavGroup key={group.label || index} group={group} />
      ))}
    </nav>
  );
}
