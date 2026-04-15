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
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav-config";

const iconMap: Record<string, LucideIcon> = {
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
};

interface SidebarNavItemProps {
  label: string;
  href: string;
  iconName: string;
  children?: NavItem[];
}

export function SidebarNavItem({ label, href, iconName, children }: SidebarNavItemProps) {
  const pathname = usePathname();
  const Icon = iconMap[iconName] ?? LayoutDashboard;

  // For items with children, check if any child is active
  const hasChildren = children && children.length > 0;
  const isChildActive = hasChildren && children.some((c) => pathname === c.href);
  const isActive = pathname === href && !hasChildren;

  const [isOpen, setIsOpen] = useState(isChildActive ?? false);

  // Collapsible parent item
  if (hasChildren) {
    return (
      <div>
        <button
          onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full transition-all duration-150 ease-in-out
            ${
              isChildActive
                ? "text-white"
                : "text-text-secondary hover:bg-card-hover hover:text-white"
            }
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar
          `}
        >
          <Icon size={18} className={isChildActive ? "text-accent-purple" : ""} />
          <span className="flex-1 text-left">{label}</span>
          <ChevronRight
            size={14}
            className={`text-text-muted transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-border/50 pl-2">
            {children.map((child) => {
              const ChildIcon = iconMap[child.iconName] ?? LayoutDashboard;
              const childActive = pathname === child.href;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  aria-current={childActive ? "page" : undefined}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-all duration-150 ease-in-out
                    ${
                      childActive
                        ? "text-white bg-accent-purple/10"
                        : "text-text-muted hover:bg-card-hover hover:text-text-secondary"
                    }
                  `}
                >
                  <ChildIcon size={15} className={childActive ? "text-accent-purple" : ""} />
                  <span>{child.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Regular nav item (no children)
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ease-in-out
        ${
          isActive
            ? "bg-gradient-to-r from-accent-purple/20 to-accent-pink/10 text-white border-l-2 border-l-accent-purple"
            : "text-text-secondary hover:bg-card-hover hover:text-white"
        }
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar
      `}
    >
      <Icon size={18} className={isActive ? "text-accent-purple" : ""} />
      <span>{label}</span>
    </Link>
  );
}
