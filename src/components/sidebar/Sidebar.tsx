import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { Logo } from "@/components/ui/Logo";
import type { TenantMembership } from "@/lib/auth";

interface SidebarProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
}

export function Sidebar({ tenants, currentTenantSlug }: SidebarProps) {
  return (
    <aside className="w-[260px] bg-sidebar h-screen flex flex-col border-r border-border flex-shrink-0">
      <div className="px-6 pt-6 pb-4">
        <Logo size="md" />
      </div>

      <SidebarNav />

      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
