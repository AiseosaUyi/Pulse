"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  type LucideIcon,
} from "lucide-react";

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
};

interface SidebarNavItemProps {
  label: string;
  href: string;
  iconName: string;
}

export function SidebarNavItem({ label, href, iconName }: SidebarNavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href;
  const Icon = iconMap[iconName] ?? LayoutDashboard;

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
