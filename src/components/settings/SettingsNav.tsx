"use client";

// Inner nav for /settings/* — a left sidebar on desktop, a
// horizontal-scrolling chip row on mobile so the IA stays
// discoverable without a massive vertical scroll.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserCircle, Users, Target, PenLine, Plug, Activity, type LucideIcon } from "lucide-react";
import type { FeatureKey } from "@/lib/features/registry";

type SettingsAccountType = "startup" | "individual";
type SettingsRole = "owner" | "admin" | "member" | "support";

/**
 * Settings in six sections. The left menu lists sections; the current
 * section's pages show as tabs above the page. Pages owned by a feature the
 * workspace switched off are hidden from the tabs (their URLs still work).
 */
export interface SettingsTab {
  label: string;
  href: string;
  /** Omitted = shown to all account types. */
  surfaces?: SettingsAccountType[];
  /** Hidden when this workspace feature is switched off. */
  feature?: FeatureKey;
}

export interface SettingsSection {
  label: string;
  icon: LucideIcon;
  tabs: SettingsTab[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    label: "Account",
    icon: UserCircle,
    tabs: [
      { label: "Profile", href: "/settings/profile" },
      { label: "Security", href: "/settings/security" },
      { label: "Notifications", href: "/settings/notifications" },
      { label: "Appearance", href: "/settings/appearance" },
    ],
  },
  {
    label: "Workspace",
    icon: Users,
    tabs: [
      { label: "Team", href: "/settings/team" },
      { label: "Features", href: "/settings/features" },
      { label: "Brand voice", href: "/settings/brand-voice" },
      { label: "Positioning", href: "/settings/brand-positioning" },
      { label: "Brand audit", href: "/settings/brand-audit" },
    ],
  },
  {
    label: "Leads",
    icon: Target,
    tabs: [
      { label: "Lead types and email", href: "/settings/outreach", surfaces: ["startup"], feature: "autopilot" },
      { label: "Where to find leads", href: "/settings/discovery", surfaces: ["startup"] },
      { label: "Who to skip", href: "/settings/outbound-filters", surfaces: ["startup"] },
      { label: "Inbox coverage", href: "/settings/conversations" },
    ],
  },
  {
    label: "Content",
    icon: PenLine,
    tabs: [
      { label: "Social accounts", href: "/settings/social-publishing" },
      { label: "Posting rhythm", href: "/settings/cadence", feature: "composer" },
      { label: "Video formats", href: "/settings/content-engine", surfaces: ["startup"], feature: "video" },
      { label: "Topic calendar", href: "/settings/content-calendar", feature: "content_calendar" },
      { label: "X listening", href: "/settings/x-listening", feature: "intel" },
      { label: "Trend scouts", href: "/settings/trend-scouts", surfaces: ["startup"], feature: "intel" },
    ],
  },
  {
    label: "Connections",
    icon: Plug,
    tabs: [{ label: "Integrations", href: "/settings/integrations" }],
  },
  {
    label: "Usage",
    icon: Activity,
    tabs: [
      { label: "AI usage", href: "/settings/ai-usage" },
      { label: "Storage", href: "/settings/storage" },
      { label: "System health", href: "/settings/system-health" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/settings/profile") {
    return pathname === "/settings" || pathname === "/settings/profile";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sections and tabs this person can see. Pure; exported for tests. */
export function visibleSettings(
  accountType: SettingsAccountType,
  role: SettingsRole | undefined,
  features: Partial<Record<FeatureKey, boolean>> | undefined
): SettingsSection[] {
  const sections = role === "support" ? SETTINGS_SECTIONS.filter((x) => x.label === "Account") : SETTINGS_SECTIONS;
  return sections
    .map((section) => ({
      ...section,
      tabs: section.tabs.filter(
        (t) =>
          (!t.surfaces || t.surfaces.includes(accountType)) && !(t.feature && features?.[t.feature] === false)
      ),
    }))
    .filter((section) => section.tabs.length > 0);
}

export function SettingsNav({
  accountType = "startup",
  role,
  features,
}: {
  accountType?: SettingsAccountType;
  role?: SettingsRole;
  features?: Partial<Record<FeatureKey, boolean>>;
}) {
  const pathname = usePathname();
  const sections = visibleSettings(accountType, role, features);
  const current = sections.find((x) => x.tabs.some((t) => isActive(pathname, t.href)));

  return (
    <>
      {/* Mobile: section chips */}
      <nav className="md:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/90 backdrop-blur border-b border-border/40 overflow-x-auto">
        <ul className="flex items-center gap-1 min-w-max">
          {sections.map((section) => {
            const active = section === current;
            return (
              <li key={section.label}>
                <Link
                  href={section.tabs[0].href}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                    active ? "bg-primary-500 text-white" : "text-text-muted hover:text-foreground hover:bg-sidebar"
                  }`}
                >
                  <section.icon size={12} />
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop: section list */}
      <nav className="hidden md:block w-48 shrink-0">
        <ul className="sticky top-6 space-y-0.5">
          {sections.map((section) => {
            const active = section === current;
            return (
              <li key={section.label}>
                <Link
                  href={section.tabs[0].href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? "bg-primary-500/10 text-primary-500 font-medium"
                      : "text-text-secondary hover:text-foreground hover:bg-sidebar"
                  }`}
                >
                  <section.icon size={14} />
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/** The current section's pages as tabs, above the page content. */
export function SettingsTabs({
  accountType = "startup",
  role,
  features,
}: {
  accountType?: SettingsAccountType;
  role?: SettingsRole;
  features?: Partial<Record<FeatureKey, boolean>>;
}) {
  const pathname = usePathname();
  const current = visibleSettings(accountType, role, features).find((x) =>
    x.tabs.some((t) => isActive(pathname, t.href))
  );
  if (!current || current.tabs.length < 2) return null;
  return (
    <nav aria-label={`${current.label} settings`} className="mb-6 border-b border-border overflow-x-auto">
      <ul className="flex gap-1 min-w-max">
        {current.tabs.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-primary-500 text-primary-500 font-medium"
                    : "border-transparent text-text-secondary hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
