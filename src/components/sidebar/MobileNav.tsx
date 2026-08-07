"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { Logo } from "@/components/ui/Logo";
import type { AccountType, TenantMembership } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  tenants: TenantMembership[];
  currentTenantSlug: string;
  currentAccountType: AccountType;
}

export function MobileNav({
  tenants,
  currentTenantSlug,
  currentAccountType,
}: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sidebar border-b border-border h-14 flex items-center justify-between px-4">
        <Logo size="sm" />
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 rounded-full hover:bg-gray-50 transition-colors cursor-pointer"
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          {isOpen ? <X size={20} className="text-gray-1200" /> : <Menu size={20} className="text-gray-1200" />}
        </button>
      </div>

      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-[#000000B3] z-40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div
        className={cn(
          "md:hidden fixed top-0 left-0 bottom-0 w-[280px] bg-sidebar z-50 flex flex-col",
          "transition-transform duration-300 ease-in-out border-r border-border",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="px-6 pt-6 pb-4 flex items-center justify-between">
          <Logo size="md" />
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-full hover:bg-card-hover transition-colors cursor-pointer"
          >
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col" onClick={() => setIsOpen(false)}>
          <SidebarNav accountType={currentAccountType} />
        </div>

        <div className="shrink-0">
          <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
        </div>
      </div>
    </>
  );
}
