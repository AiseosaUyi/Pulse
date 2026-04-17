"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "Dashboard", href: "/seo-tracker" },
  { label: "Keywords", href: "/seo-tracker/keywords" },
  { label: "Topical Map", href: "/seo-tracker/topical-map" },
  { label: "Blog Writer", href: "/seo-tracker/blog-writer" },
  { label: "Programmatic", href: "/seo-tracker/programmatic" },
  { label: "SERP Analysis", href: "/seo-tracker/serp-analysis" },
];

export function SEOTabNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border/50 mb-6 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 md:px-4 py-2.5 text-xs md:text-sm font-medium transition-colors relative whitespace-nowrap touch-manipulation
              ${isActive
                ? "text-foreground"
                : "text-text-muted hover:text-text-secondary"
              }
            `}
          >
            {tab.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500 rounded-full" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
