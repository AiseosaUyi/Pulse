import { Suspense } from "react";
import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { Logo } from "@/components/ui/Logo";
import { NeedsYouBadge } from "@/components/needs-you/NeedsYouBadge";
import { ActionQueueBadge } from "@/components/action-queue/ActionQueueBadge";
import type { AccountType, TenantMembership } from "@/lib/auth";
import type { FeatureKey } from "@/lib/features/registry";

interface SidebarProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
  currentAccountType: AccountType;
  currentRole: TenantMembership["role"];
  features?: Partial<Record<FeatureKey, boolean>>;
}

export function Sidebar({
  tenants,
  currentTenantSlug,
  currentAccountType,
  currentRole,
  features,
}: SidebarProps) {
  return (
    <aside className="w-[260px] bg-sidebar h-screen flex flex-col border-r border-border flex-shrink-0">
      <div className="px-6 pt-6 pb-3">
        <Logo size="md" />
      </div>

      <SidebarNav
        accountType={currentAccountType}
        role={currentRole}
        features={features}
        badges={{
          // Badges stream in after the page; they never hold it up.
          "/dashboard": (
            <Suspense fallback={null}>
              <ActionQueueBadge tenantSlug={currentTenantSlug} />
            </Suspense>
          ),
        }}
      />

      {currentRole !== "support" && (
        <Suspense fallback={null}>
          <NeedsYouBadge tenantSlug={currentTenantSlug} accountType={currentAccountType} />
        </Suspense>
      )}

      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
