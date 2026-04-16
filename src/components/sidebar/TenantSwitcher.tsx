"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Settings, Check } from "lucide-react";
import type { TenantMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface TenantSwitcherProps {
  tenants: TenantMembership[];
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

  function switchTenant(slug: string) {
    document.cookie = `tenant=${slug};path=/;max-age=${60 * 60 * 24 * 365}`;
    setIsOpen(false);
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (!current) return null;

  return (
    <div ref={ref} className="relative px-3 py-3 border-t border-white-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors duration-200 cursor-pointer",
          "hover:bg-gray-50 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
          isOpen && "bg-gray-50"
        )}
      >
        <span className="w-8 h-8 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center text-xs [font-family:'Satoshi-700',var(--font-sans)] flex-shrink-0">
          {current.name.charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block truncate text-gray-1200 [font-family:'Satoshi-500',var(--font-sans)]">
            {current.name}
          </span>
          <span className="block truncate text-[11px] text-gray-1000 capitalize">{current.role}</span>
        </span>
        <ChevronDown
          size={14}
          className={cn("text-gray-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-white border border-white-200 rounded-xl shadow-custom-100 overflow-hidden py-1">
          <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400">
            Workspaces
          </p>
          {tenants.map((tenant) => (
            <button
              key={tenant.slug}
              onClick={() => switchTenant(tenant.slug)}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors duration-150 cursor-pointer",
                tenant.slug === currentSlug
                  ? "text-primary-500 bg-primary-50"
                  : "text-gray-1200 hover:bg-gray-50"
              )}
            >
              <span
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] flex-shrink-0",
                  "[font-family:'Satoshi-700',var(--font-sans)]",
                  tenant.slug === currentSlug
                    ? "bg-primary-500 text-white"
                    : "bg-gray-100 text-gray-1200"
                )}
              >
                {tenant.name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate flex-1 text-left">{tenant.name}</span>
              <span className="text-gray-1000 text-[11px] ml-auto capitalize">{tenant.role}</span>
              {tenant.slug === currentSlug && <Check size={12} className="text-primary-500" />}
            </button>
          ))}

          <div className="border-t border-white-200 mt-1 pt-1">
            <Link
              href="/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-1200 hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
            >
              <Settings size={14} className="text-gray-500" />
              <span>Settings</span>
            </Link>
            <button
              onClick={signOut}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-1200 hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
            >
              <LogOut size={14} className="text-gray-500" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
