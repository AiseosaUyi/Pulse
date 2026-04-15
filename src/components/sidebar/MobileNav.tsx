"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import type { Tenant } from "@/lib/types/tenant";

interface MobileNavProps {
  tenants: Tenant[];
  currentTenantSlug: string;
}

export function MobileNav({ tenants, currentTenantSlug }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sidebar border-b border-border h-14 flex items-center justify-between px-4">
        <h1 className="text-lg font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-accent-purple to-accent-pink bg-clip-text text-transparent italic">
            PULSE
          </span>
        </h1>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2.5 rounded-lg hover:bg-card-hover transition-colors touch-manipulation"
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          {isOpen ? <X size={22} className="text-white" /> : <Menu size={22} className="text-white" />}
        </button>
      </div>

      {/* Overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-out sidebar */}
      <div
        className={`md:hidden fixed top-0 left-0 bottom-0 w-[280px] bg-sidebar z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-accent-purple to-accent-pink bg-clip-text text-transparent italic">
                PULSE
              </span>
            </h1>
            <p className="text-[11px] font-medium uppercase tracking-widest text-text-muted mt-0.5">
              Marketing OS
            </p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-lg hover:bg-card-hover transition-colors"
          >
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        {/* Nav — clicking any link closes the menu. min-h-0 constrains height so SidebarNav's overflow-y-auto scrolls */}
        <div className="flex-1 min-h-0 flex flex-col" onClick={() => setIsOpen(false)}>
          <SidebarNav />
        </div>

        {/* Tenant switcher — pinned to bottom */}
        <div className="shrink-0">
          <TenantSwitcher tenants={tenants} currentSlug={currentTenantSlug} />
        </div>
      </div>
    </>
  );
}
