import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import type { TenantMembership } from "@/lib/auth";

interface SidebarProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
}

export function Sidebar({ tenants, currentTenantSlug }: SidebarProps) {
  return (
    <aside className="w-[260px] bg-white h-screen flex flex-col border-r border-white-200 flex-shrink-0">
      <div className="px-6 pt-6 pb-4">
        <h1
          className="text-xl tracking-tight text-gray-1100"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          PULSE
        </h1>
        <p className="text-xs text-gray-1000 mt-0.5">A tool of Gruve</p>
      </div>

      <SidebarNav />

      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
