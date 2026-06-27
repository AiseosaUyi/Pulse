import { SidebarNavItem } from "./SidebarNavItem";
import type { NavGroup } from "@/lib/nav-config";

interface SidebarNavGroupProps {
  group: NavGroup;
}

export function SidebarNavGroup({ group }: SidebarNavGroupProps) {
  return (
    <div className="mt-4 first:mt-0">
      {group.label && (
        <p className="px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-1.5">
          {group.label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <SidebarNavItem
            key={item.href}
            label={item.label}
            href={item.href}
            iconName={item.iconName}
            childItems={item.children}
          />
        ))}
      </div>
    </div>
  );
}
