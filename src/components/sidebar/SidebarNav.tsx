import { SidebarNavGroup } from "./SidebarNavGroup";
import { navGroupsForAccountType, type NavAccountType } from "@/lib/nav-config";

export function SidebarNav({ accountType }: { accountType: NavAccountType }) {
  const groups = navGroupsForAccountType(accountType);
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3">
      {groups.map((group) => (
        <SidebarNavGroup key={group.label} group={group} />
      ))}
    </nav>
  );
}
