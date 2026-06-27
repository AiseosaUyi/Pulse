import Link from "next/link";
import { PenLine } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { Logo } from "@/components/ui/Logo";
import type { AccountType, TenantMembership } from "@/lib/auth";
import type { OnboardingProgress } from "@/lib/services/onboarding";

interface SidebarProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
  currentTenantName: string;
  currentAccountType: AccountType;
  onboardingProgress: OnboardingProgress;
}

export function Sidebar({
  tenants,
  currentTenantSlug,
  currentTenantName,
  currentAccountType,
  onboardingProgress,
}: SidebarProps) {
  return (
    <aside className="w-[260px] bg-sidebar h-screen flex flex-col border-r border-border flex-shrink-0">
      <div className="px-6 pt-6 pb-3">
        <Logo size="md" />
      </div>

      {/* Primary action — always visible, always one click away */}
      <div className="px-3 pb-3">
        <Link
          href="/composer"
          className="flex items-center gap-2.5 w-full px-4 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors"
        >
          <PenLine size={15} />
          New post
        </Link>
      </div>

      {currentAccountType === "startup" && (
        <OnboardingChecklist
          progress={onboardingProgress}
          tenantSlug={currentTenantSlug}
          tenantName={currentTenantName}
        />
      )}

      <SidebarNav accountType={currentAccountType} />

      <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
    </aside>
  );
}
