"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { AddPostModal } from "@/components/intelligence/AddPostModal";
import { IntelCard } from "@/components/intelligence/IntelCard";
import { XSignalCard } from "@/components/intelligence/XSignalCard";
import { XPostIdeasPanel } from "@/components/intelligence/XPostIdeasPanel";
import { GrowthGuide } from "@/components/intelligence/GrowthGuide";
import type { Competitor, IntelCard as IntelCardType } from "@/lib/types/intelligence";
import type { XSignalCard as XSignalCardType } from "@/lib/types/x-intel";

type Tab = "competitors" | "x_signals";

interface Props {
  feed: IntelCardType[];
  xSignals: XSignalCardType[];
  competitors: Competitor[];
  tenantSlug: string;
}

export function IntelFeedTabs({ feed, xSignals, competitors, tenantSlug }: Props) {
  const [tab, setTab] = useState<Tab>("competitors");
  const [showModal, setShowModal] = useState(false);
  const [visibleXSignals, setVisibleXSignals] = useState(xSignals);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "competitors", label: "Competitor intel", count: feed.length || undefined },
    { id: "x_signals", label: "X signals", count: visibleXSignals.length || undefined },
  ];

  // Top signal IDs for post idea generation (prefer account_monitor, then keyword)
  const topSignalIds = visibleXSignals
    .slice()
    .sort((a, b) => {
      // Prioritise account_monitor for post ideas (they're real niche accounts)
      if (a.signalType === "account_monitor" && b.signalType !== "account_monitor") return -1;
      if (b.signalType === "account_monitor" && a.signalType !== "account_monitor") return 1;
      return b.likes - a.likes;
    })
    .slice(0, 8)
    .map((c) => c.id);

  return (
    <>
      {/* Tab bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 border-b border-border w-full">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px ${
                tab === t.id
                  ? "border-primary-500 text-primary-500"
                  : "border-transparent text-text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span
                  className={`ml-2 text-[11px] rounded-full px-1.5 py-0.5 font-semibold ${
                    tab === t.id
                      ? "bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400"
                      : "bg-gray-100 dark:bg-white/10 text-text-muted"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}

          {/* Right-side actions */}
          <div className="ml-auto flex items-center gap-2 pb-1">
            {tab === "competitors" && (
              <button
                onClick={() => setShowModal(true)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-primary-500 hover:bg-primary-600 transition-colors"
              >
                + Log competitor post
              </button>
            )}
            {tab === "x_signals" && (
              <Link
                href="/settings/x-listening"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white-200 dark:border-border text-gray-1000 dark:text-text-muted hover:text-foreground hover:border-gray-400 transition-colors"
              >
                <Settings size={12} />
                Configure
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Competitor intel */}
      {tab === "competitors" && (
        <>
          {feed.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p
                className="text-base text-gray-1100 dark:text-foreground mb-1"
                style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
              >
                No competitor posts yet
              </p>
              <p className="text-sm text-text-muted mb-4">
                Add a competitor post and get AI-powered strategic analysis.
              </p>
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              >
                Add your first post
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {feed.map((card) => (
                <IntelCard key={card.id} card={card} tenantSlug={tenantSlug} />
              ))}
            </div>
          )}

          <AddPostModal
            isOpen={showModal}
            onClose={() => setShowModal(false)}
            competitors={competitors}
            tenantSlug={tenantSlug}
          />
        </>
      )}

      {/* X Signals */}
      {tab === "x_signals" && (
        <>
          {visibleXSignals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p
                className="text-base text-gray-1100 dark:text-foreground mb-1"
                style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
              >
                No X signals yet
              </p>
              <p className="text-sm text-text-muted mb-4">
                Configure your keywords and accounts — Pulse scans X 4× a day
                and surfaces relevant conversations here.
              </p>
              <Link
                href="/settings/x-listening"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              >
                <Settings size={14} />
                Set up X listening
              </Link>
            </div>
          ) : (
            <>
              {/* Growth playbook */}
              <GrowthGuide />

              {/* Post ideas — inspired by monitored accounts */}
              {topSignalIds.length > 0 && (
                <XPostIdeasPanel tenantSlug={tenantSlug} topSignalIds={topSignalIds} />
              )}

              {/* Source legend */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <span className="text-[11px] text-text-muted font-medium uppercase tracking-wide">
                  Sources:
                </span>
                <span className="inline-flex items-center text-[11px] font-medium rounded-full px-2.5 py-0.5 bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400">
                  keyword match
                </span>
                <span className="inline-flex items-center text-[11px] font-medium rounded-full px-2.5 py-0.5 bg-white-100 text-gray-700 dark:bg-white/10 dark:text-gray-300">
                  account post
                </span>
                <span className="inline-flex items-center text-[11px] font-medium rounded-full px-2.5 py-0.5 bg-warning-50 text-warning-500 dark:bg-warning-500/15">
                  trending
                </span>
              </div>

              {/* Signal cards */}
              <div className="space-y-4">
                {visibleXSignals.map((card) => (
                  <XSignalCard key={card.id} card={card} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
