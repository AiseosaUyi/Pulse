"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  CircleDot,
  TrendingUp,
  Sparkles,
  Target,
  Diamond,
  PlusCircle,
  Radio,
  FolderOpen,
  Search,
  MessageCircle,
  Clock,
  Eye,
  FileText,
  BarChart3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard, CircleDot, TrendingUp, Sparkles, Target, Diamond,
  PlusCircle, Radio, FolderOpen, Search, MessageCircle, Clock, Eye, FileText,
  BarChart3,
};

interface SidebarNavItemProps {
  label: string;
  href: string;
  iconName: string;
  childItems?: NavItem[];
}

export function SidebarNavItem({ label, href, iconName, childItems }: SidebarNavItemProps) {
  const pathname = usePathname();
  const Icon = iconMap[iconName] ?? LayoutDashboard;

  const hasChildren = childItems && childItems.length > 0;
  const isChildActive = hasChildren && childItems.some((c) => pathname === c.href);
  const isActive = pathname === href && !hasChildren;

  const [isOpen, setIsOpen] = useState(isChildActive ?? false);

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors duration-200 cursor-pointer",
            "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
            isChildActive
              ? "text-gray-1200 bg-gray-50"
              : "text-gray-1000 hover:bg-gray-50 hover:text-gray-1200"
          )}
        >
          <Icon size={17} className={cn(isChildActive ? "text-primary-500" : "text-gray-500")} />
          <span className="flex-1 text-left [font-family:'Satoshi-500',var(--font-sans)]">{label}</span>
          <ChevronRight
            size={14}
            className={cn("text-gray-400 transition-transform duration-200", isOpen && "rotate-90")}
          />
        </button>

        {isOpen && (
          <div className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-white-200 pl-2">
            {childItems.map((child) => {
              const ChildIcon = iconMap[child.iconName] ?? LayoutDashboard;
              const childActive = pathname === child.href;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors duration-200",
                    childActive
                      ? "text-primary-500 bg-primary-50 [font-family:'Satoshi-500',var(--font-sans)]"
                      : "text-gray-1000 hover:bg-gray-50 hover:text-gray-1200"
                  )}
                >
                  <ChildIcon size={14} className={childActive ? "text-primary-500" : "text-gray-400"} />
                  <span>{child.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200",
        "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
        isActive
          ? "bg-primary-50 text-primary-500 [font-family:'Satoshi-500',var(--font-sans)]"
          : "text-gray-1000 hover:bg-gray-50 hover:text-gray-1200"
      )}
    >
      <Icon size={17} className={isActive ? "text-primary-500" : "text-gray-500"} />
      <span>{label}</span>
    </Link>
  );
}
