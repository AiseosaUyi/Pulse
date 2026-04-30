"use client";

// Inner nav for /settings/* — a left sidebar on desktop, a
// horizontal-scrolling chip row on mobile so the IA stays
// discoverable without a massive vertical scroll.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  UserCircle,
  Users,
  Lock,
  Bell,
  Palette,
  Sparkles,
  Zap,
  TrendingUp,
  HardDrive,
  Target,
  Plug,
  Radar,
  type LucideIcon,
} from "lucide-react";

export interface SettingsNavGroup {
  label: string;
  items: Array<{ label: string; href: string; icon: LucideIcon }>;
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/settings/profile", icon: UserCircle },
      { label: "Security", href: "/settings/security", icon: Lock },
      { label: "Notifications", href: "/settings/notifications", icon: Bell },
      { label: "Appearance", href: "/settings/appearance", icon: Palette },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Team", href: "/settings/team", icon: Users },
      {
        label: "Brand positioning",
        href: "/settings/brand-positioning",
        icon: Target,
      },
      { label: "Brand voice", href: "/settings/brand-voice", icon: Sparkles },
      {
        label: "Trend scouts",
        href: "/settings/trend-scouts",
        icon: TrendingUp,
      },
      {
        label: "Outbound filters",
        href: "/settings/outbound-filters",
        icon: Radar,
      },
    ],
  },
  {
    label: "Integrations & usage",
    items: [
      { label: "Integrations", href: "/settings/integrations", icon: Plug },
      { label: "AI usage", href: "/settings/ai-usage", icon: Zap },
      { label: "Storage", href: "/settings/storage", icon: HardDrive },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/settings/profile") {
    return pathname === "/settings" || pathname === "/settings/profile";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: horizontal-scrolling chip row pinned below the app header */}
      <nav className="md:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/90 backdrop-blur border-b border-border/40 overflow-x-auto">
        <ul className="flex items-center gap-1 min-w-max">
          {SETTINGS_NAV.flatMap((g) => g.items).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                    active
                      ? "bg-primary-500 text-white"
                      : "text-text-muted hover:text-foreground hover:bg-sidebar"
                  }`}
                >
                  <item.icon size={12} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop: left sidebar */}
      <nav className="hidden md:block w-56 shrink-0">
        <div className="sticky top-6 space-y-6">
          {SETTINGS_NAV.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2 px-3">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                          active
                            ? "bg-primary-500/10 text-primary-500 font-medium"
                            : "text-text-secondary hover:text-foreground hover:bg-sidebar"
                        }`}
                      >
                        <item.icon size={14} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
