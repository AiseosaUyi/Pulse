"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { Tenant } from "@/lib/types/tenant";

interface TenantSwitcherProps {
  tenants: Tenant[];
  currentSlug: string;
}

export function TenantSwitcher({ tenants, currentSlug }: TenantSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const current = tenants.find((t) => t.slug === currentSlug) ?? tenants[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function switchTenant(slug: string) {
    document.cookie = `tenant=${slug};path=/;max-age=${60 * 60 * 24 * 365}`;
    setIsOpen(false);
    router.refresh();
  }

  return (
    <div ref={ref} className="relative px-3 py-4 border-t border-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-colors duration-150
          hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
      >
        <span className="w-2.5 h-2.5 rounded-full gradient-purple-pink flex-shrink-0" />
        <span className="text-text-secondary truncate flex-1 text-left">
          {current.domain}
        </span>
        <ChevronDown
          size={14}
          className={`text-text-muted transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {tenants.map((tenant) => (
            <button
              key={tenant.slug}
              onClick={() => switchTenant(tenant.slug)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-card-hover
                ${tenant.slug === currentSlug ? "text-white" : "text-text-secondary"}
              `}
            >
              <span className="w-2 h-2 rounded-full gradient-purple-pink flex-shrink-0" />
              <span className="truncate">{tenant.name}</span>
              <span className="text-text-muted text-xs ml-auto">{tenant.domain}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
