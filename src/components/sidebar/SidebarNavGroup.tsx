import { SidebarNavItem } from "./SidebarNavItem";
import type { NavGroup } from "@/lib/nav-config";

interface SidebarNavGroupProps {
  group: NavGroup;
}

export function SidebarNavGroup({ group }: SidebarNavGroupProps) {
  return (
    <div className="mt-6">
      <p className="px-3 text-[11px] font-medium uppercase tracking-widest text-text-muted mb-2">
        {group.label}
      </p>
      <div className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <SidebarNavItem
            key={item.href}
            label={item.label}
            href={item.href}
            iconName={item.iconName}
          />
        ))}
      </div>
    </div>
  );
}
