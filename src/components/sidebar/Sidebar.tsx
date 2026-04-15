import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import type { Tenant } from "@/lib/types/tenant";

interface SidebarProps {
  tenants: Tenant[];
  currentTenantSlug: string;
}

export function Sidebar({ tenants, currentTenantSlug }: SidebarProps) {
  return (
    <aside className="w-[280px] bg-sidebar h-screen flex flex-col border-r border-border flex-shrink-0">
      {/* Logo */}
      <div className="px-6 pt-6 pb-2">
        <h1 className="text-xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-accent-purple to-accent-pink bg-clip-text text-transparent italic">
            PULSE
          </span>
        </h1>
        <p className="text-[11px] font-medium uppercase tracking-widest text-text-muted mt-0.5">
          Marketing OS
        </p>
      </div>

      {/* Navigation */}
      <SidebarNav />

      {/* Tenant Switcher */}
      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
