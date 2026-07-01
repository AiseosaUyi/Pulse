"use client";

import { useState, useTransition } from "react";
import { Trash2, History, X, ChevronDown, ChevronUp, Upload } from "lucide-react";
import {
  InstagramAnalytics,
  TwitterAnalytics,
  TikTokAnalytics,
  LinkedInAnalytics,
} from "./PlatformAnalytics";
import { AIAnalystPanel } from "./AIAnalystPanel";
import { clearPlatformMetrics } from "@/lib/actions/analytics-import";
import type { OwnPostMetric, OwnMetricsPlatform, ImportSession } from "@/lib/types/own-metrics";

const TABS: { id: OwnMetricsPlatform; label: string; color: string }[] = [
  { id: "instagram", label: "Instagram", color: "#E1306C" },
  { id: "twitter", label: "X / Twitter", color: "#000000" },
  { id: "tiktok", label: "TikTok", color: "#FE2C55" },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2" },
];

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  posts: OwnPostMetric[];
  tenantSlug: string;
  reportsByPlatform: Record<string, { narrative: string; recommendations: Array<{ title: string; body: string }>; generated_at: string } | null>;
  importSessions: ImportSession[];
  isOwner?: boolean;
}

export function PlatformTabsClient({ posts, tenantSlug, reportsByPlatform, importSessions, isOwner }: Props) {
  const mostDataPlatform = TABS.map((t) => ({
    id: t.id,
    count: posts.filter((p) => p.platform === t.id).length,
  })).sort((a, b) => b.count - a.count)[0]?.id ?? "instagram";

  const [active, setActive] = useState<OwnMetricsPlatform>(mostDataPlatform);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, startClearing] = useTransition();

  const platformPosts = posts.filter((p) => p.platform === active);
  const filteredPosts = selectedBatchId
    ? platformPosts.filter((p) => p.importBatchId === selectedBatchId)
    : platformPosts;
  const hasPlatformData = platformPosts.length > 0;

  const platformSessions = importSessions.filter((s) => s.platform === active);
  const lastSession = platformSessions[0] ?? null;

  const handleTabSwitch = (id: OwnMetricsPlatform) => {
    setActive(id);
    setSelectedBatchId(null);
    setConfirmClear(false);
    setHistoryOpen(false);
  };

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

  const selectedSession = selectedBatchId ? platformSessions.find((s) => s.id === selectedBatchId) : null;

  return (
    <section className="space-y-5">
      {/* Tab row */}
      <div className="flex items-center justify-between gap-4 border-b border-border/30">
        <div className="flex items-center gap-1 overflow-x-auto pb-0">
          {TABS.map((tab) => {
            const count = posts.filter((p) => p.platform === tab.id).length;
            const tabSessions = importSessions.filter((s) => s.platform === tab.id);
            const tabLastImport = tabSessions[0] ?? null;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabSwitch(tab.id)}
                className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap text-left ${
                  isActive ? "text-foreground" : "text-text-muted hover:text-foreground"
                }`}
              >
                <span>{tab.label}</span>
                {count > 0 && (
                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-primary-500/10 text-primary-500" : "bg-sidebar text-text-muted"
                  }`}>
                    {count}
                  </span>
                )}
                {tabLastImport && (
                  <span className="block text-[10px] text-text-muted/60 leading-none pb-0.5">
                    Imported {relativeDate(tabLastImport.importedAt)}
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

        {/* Right-side controls */}
        <div className="shrink-0 flex items-center gap-2 pb-1">
          {/* Import history toggle */}
          {platformSessions.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors ${
                historyOpen
                  ? "text-primary-500 bg-primary-500/10"
                  : "text-text-muted hover:text-foreground hover:bg-sidebar"
              }`}
            >
              <History size={12} />
              History
              {historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}

          {/* Owner-only clear */}
          {isOwner && hasPlatformData && (
            !confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-500/5"
              >
                <Trash2 size={12} />
                Clear
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
            )
          )}
        </div>
      </div>

      {/* Import history panel */}
      {historyOpen && platformSessions.length > 0 && (
        <div className="bg-sidebar/50 border border-border/40 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Import history</p>
            <button
              type="button"
              onClick={() => { setSelectedBatchId(null); }}
              className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                !selectedBatchId
                  ? "bg-primary-500/10 text-primary-500 font-medium"
                  : "text-text-muted hover:text-foreground"
              }`}
            >
              All time ({platformPosts.length} posts)
            </button>
          </div>
          <div className="space-y-1.5">
            {platformSessions.map((session) => {
              const isSelected = selectedBatchId === session.id;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedBatchId(isSelected ? null : session.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors ${
                    isSelected
                      ? "bg-primary-500/10 border border-primary-500/20"
                      : "hover:bg-card border border-transparent"
                  }`}
                >
                  <div>
                    <p className={`text-xs font-medium ${isSelected ? "text-primary-500" : "text-foreground"}`}>
                      {session.label ?? `${session.postCount} posts`}
                    </p>
                    {session.periodStart && session.periodEnd && session.periodStart !== session.periodEnd && (
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {shortDate(session.periodStart)} – {shortDate(session.periodEnd)}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-[10px] text-text-muted">{relativeDate(session.importedAt)}</p>
                    <p className="text-[10px] text-text-muted/60">{session.postCount} posts</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Active filter chip */}
      {selectedSession && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-primary-500/10 text-primary-500 text-xs px-3 py-1.5 rounded-full font-medium">
            <Upload size={11} />
            Showing: {selectedSession.label ?? "selected import"}
            <button
              type="button"
              onClick={() => setSelectedBatchId(null)}
              className="ml-1 hover:text-primary-600"
            >
              <X size={11} />
            </button>
          </div>
          <span className="text-xs text-text-muted">{filteredPosts.length} posts in this import</span>
        </div>
      )}

      {/* AI Analyst */}
      <AIAnalystPanel
        key={`${active}-${selectedBatchId ?? "all"}`}
        tenantSlug={tenantSlug}
        platform={active}
        posts={filteredPosts}
        initialReport={selectedBatchId ? null : (reportsByPlatform[active] ?? null)}
      />

      {/* Platform-specific view */}
      {active === "instagram" && <InstagramAnalytics posts={filteredPosts} />}
      {active === "twitter" && <TwitterAnalytics posts={filteredPosts} />}
      {active === "tiktok" && <TikTokAnalytics posts={filteredPosts} />}
      {active === "linkedin" && <LinkedInAnalytics posts={filteredPosts} />}
    </section>
  );
}
