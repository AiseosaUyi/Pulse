import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { Logo } from "@/components/ui/Logo";
import type { TenantMembership } from "@/lib/auth";
import type { OnboardingProgress } from "@/lib/services/onboarding";

interface SidebarProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
  currentTenantName: string;
  onboardingProgress: OnboardingProgress;
}

export function Sidebar({
  tenants,
  currentTenantSlug,
  currentTenantName,
  onboardingProgress,
}: SidebarProps) {
  return (
    <aside className="w-[260px] bg-sidebar h-screen flex flex-col border-r border-border flex-shrink-0">
      <div className="px-6 pt-6 pb-3">
        <Logo size="md" />
      </div>

      <OnboardingChecklist
        progress={onboardingProgress}
        tenantSlug={currentTenantSlug}
        tenantName={currentTenantName}
      />

      <SidebarNav />

      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
