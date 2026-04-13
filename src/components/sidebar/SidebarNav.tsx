import { SidebarNavGroup } from "./SidebarNavGroup";
import { navGroups } from "@/lib/nav-config";

export function SidebarNav() {
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3">
      {navGroups.map((group) => (
        <SidebarNavGroup key={group.label} group={group} />
      ))}
    </nav>
  );
}
