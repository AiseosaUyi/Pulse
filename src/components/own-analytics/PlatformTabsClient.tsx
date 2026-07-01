"use client";

import { useState } from "react";
import {
  InstagramAnalytics,
  TwitterAnalytics,
  TikTokAnalytics,
  LinkedInAnalytics,
} from "./PlatformAnalytics";
import { AIAnalystPanel } from "./AIAnalystPanel";
import type { OwnPostMetric, OwnMetricsPlatform } from "@/lib/types/own-metrics";

const TABS: { id: OwnMetricsPlatform; label: string; color: string }[] = [
  { id: "instagram", label: "Instagram", color: "#E1306C" },
  { id: "twitter", label: "X / Twitter", color: "#000000" },
  { id: "tiktok", label: "TikTok", color: "#FE2C55" },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2" },
];

interface Props {
  posts: OwnPostMetric[];
  tenantSlug: string;
  reportsByPlatform: Record<string, { narrative: string; recommendations: Array<{ title: string; body: string }>; generated_at: string } | null>;
}

export function PlatformTabsClient({ posts, tenantSlug, reportsByPlatform }: Props) {
  // Default to the platform with the most data
  const mostDataPlatform = TABS.map((t) => ({
    id: t.id,
    count: posts.filter((p) => p.platform === t.id).length,
  })).sort((a, b) => b.count - a.count)[0]?.id ?? "instagram";

  const [active, setActive] = useState<OwnMetricsPlatform>(mostDataPlatform);

  const platformPosts = posts.filter((p) => p.platform === active);

  return (
    <section className="space-y-6">
      {/* Tab row */}
      <div className="flex items-center gap-1 border-b border-border/30 overflow-x-auto pb-0">
        {TABS.map((tab) => {
          const count = posts.filter((p) => p.platform === tab.id).length;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive ? "text-foreground" : "text-text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  isActive ? "bg-primary-500/10 text-primary-500" : "bg-sidebar text-text-muted"
                }`}>
                  {count}
                </span>
              )}
              {/* Active indicator */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-sm"
                  style={{ backgroundColor: tab.color }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* AI Analyst */}
      <AIAnalystPanel
        tenantSlug={tenantSlug}
        platform={active}
        posts={platformPosts}
        initialReport={reportsByPlatform[active] ?? null}
      />

      {/* Platform-specific view */}
      {active === "instagram" && <InstagramAnalytics posts={posts} />}
      {active === "twitter" && <TwitterAnalytics posts={posts} />}
      {active === "tiktok" && <TikTokAnalytics posts={posts} />}
      {active === "linkedin" && <LinkedInAnalytics posts={posts} />}
    </section>
  );
}
