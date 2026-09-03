import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { Logo } from "@/components/ui/Logo";
import { NeedsYouBadge } from "@/components/needs-you/NeedsYouBadge";
import { ActionQueueBadge } from "@/components/action-queue/ActionQueueBadge";
import type { AccountType, TenantMembership } from "@/lib/auth";

interface SidebarProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
  currentAccountType: AccountType;
  currentRole: TenantMembership["role"];
}

export function Sidebar({
  tenants,
  currentTenantSlug,
  currentAccountType,
  currentRole,
}: SidebarProps) {
  return (
    <aside className="w-[260px] bg-sidebar h-screen flex flex-col border-r border-border flex-shrink-0">
      <div className="px-6 pt-6 pb-3">
        <Logo size="md" />
      </div>

      <SidebarNav
        accountType={currentAccountType}
        role={currentRole}
        badges={{ "/dashboard": <ActionQueueBadge tenantSlug={currentTenantSlug} /> }}
      />

      {currentRole !== "support" && (
        <NeedsYouBadge tenantSlug={currentTenantSlug} accountType={currentAccountType} />
      )}

      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
