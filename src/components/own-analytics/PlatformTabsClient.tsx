"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  InstagramAnalytics,
  TwitterAnalytics,
  TikTokAnalytics,
  LinkedInAnalytics,
} from "./PlatformAnalytics";
import { AIAnalystPanel } from "./AIAnalystPanel";
import { clearPlatformMetrics } from "@/lib/actions/analytics-import";
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
  isOwner?: boolean;
}

export function PlatformTabsClient({ posts, tenantSlug, reportsByPlatform, isOwner }: Props) {
  const mostDataPlatform = TABS.map((t) => ({
    id: t.id,
    count: posts.filter((p) => p.platform === t.id).length,
  })).sort((a, b) => b.count - a.count)[0]?.id ?? "instagram";

  const [active, setActive] = useState<OwnMetricsPlatform>(mostDataPlatform);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, startClearing] = useTransition();

  const platformPosts = posts.filter((p) => p.platform === active);
  const hasPlatformData = platformPosts.length > 0;

  const handleClear = () => {
    startClearing(async () => {
      const res = await clearPlatformMetrics(active);
      if (res.success) {
        setConfirmClear(false);
        window.location.reload();
      } else {
        alert(res.error);
      }
    });
  };

  return (
    <section className="space-y-6">
      {/* Tab row */}
      <div className="flex items-center justify-between gap-4 border-b border-border/30">
        <div className="flex items-center gap-1 overflow-x-auto pb-0">
          {TABS.map((tab) => {
            const count = posts.filter((p) => p.platform === tab.id).length;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActive(tab.id); setConfirmClear(false); }}
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

        {/* Owner-only clear button */}
        {isOwner && hasPlatformData && (
          <div className="shrink-0 pb-1">
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-500/5"
              >
                <Trash2 size={12} />
                Clear data
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-500">Delete all {active} data?</span>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={clearing}
                  className="text-xs font-medium text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-md transition-colors disabled:opacity-50"
                >
                  {clearing ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-xs text-text-muted hover:text-foreground px-2 py-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Analyst */}
      <AIAnalystPanel
        key={active}
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
