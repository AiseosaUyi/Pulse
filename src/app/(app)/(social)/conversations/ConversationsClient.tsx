"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { EngagementInbox } from "@/components/engagement/EngagementInbox";
import { EngageClient } from "@/app/(app)/(social)/engage/client";
import { AddEngagementButton } from "@/app/(app)/(social)/engagement/client";
import type { AccountType } from "@/lib/auth";
import type { EngagementItem, EngagementSummary } from "@/lib/types/engagement";
import type { EngageCandidate } from "@/lib/services/engage";

interface Props {
  accountType: AccountType;
  tenantSlug: string;
  inboxItems: EngagementItem[];
  inboxSummary: EngagementSummary;
  candidates: EngageCandidate[];
}

type TabId = "inbox" | "join";

function ConversationsInner({ accountType, tenantSlug, inboxItems, inboxSummary, candidates }: Props) {
  const searchParams = useSearchParams();
  const paramTab = searchParams.get("tab");

  const defaultTab: TabId =
    paramTab === "inbox" || paramTab === "join"
      ? paramTab
      : accountType === "startup"
      ? "inbox"
      : "join";

  const [tab, setTab] = useState<TabId>(defaultTab);

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: "inbox", label: "Inbox", badge: inboxSummary.unread || undefined },
    { id: "join", label: "Join conversations" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Conversations</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Respond to your audience and join conversations in your space.
          </p>
        </div>
        {tab === "inbox" && <AddEngagementButton />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
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
            {t.badge != null && (
              <span
                className={`ml-2 text-[11px] rounded-full px-1.5 py-0.5 font-semibold ${
                  tab === t.id
                    ? "bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400"
                    : "bg-gray-100 dark:bg-white/10 text-text-muted"
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Inbox tab */}
      {tab === "inbox" && (
        <>
          {inboxItems.length === 0 && accountType === "individual" ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p className="text-base font-semibold text-foreground mb-1">No messages yet</p>
              <p className="text-sm text-text-muted mb-4">
                Connect Instagram or TikTok to see your DMs, comments, and mentions here.
              </p>
              <Link
                href="/settings/social-publishing"
                className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              >
                Connect accounts →
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
                <div className="bg-card rounded-xl p-4 border border-border/50">
                  <p className="text-text-secondary text-xs">Unread</p>
                  <p className="text-2xl font-bold text-status-red mt-1">{inboxSummary.unread}</p>
                </div>
                <div className="bg-card rounded-xl p-4 border border-border/50">
                  <p className="text-text-secondary text-xs">Needs Reply</p>
                  <p className="text-2xl font-bold text-status-yellow mt-1">{inboxSummary.unreplied}</p>
                </div>
                <div className="bg-card rounded-xl p-4 border border-border/50">
                  <p className="text-text-secondary text-xs">DMs</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{inboxSummary.dms}</p>
                </div>
                <div className="bg-card rounded-xl p-4 border border-border/50">
                  <p className="text-text-secondary text-xs">Mentions</p>
                  <p className="text-2xl font-bold text-primary-500 mt-1">{inboxSummary.mentions}</p>
                </div>
              </div>
              <EngagementInbox items={inboxItems} />
            </>
          )}
        </>
      )}

      {/* Join tab */}
      {tab === "join" && (
        <EngageClient tenantSlug={tenantSlug} candidates={candidates} />
      )}
    </div>
  );
}

export function ConversationsClient(props: Props) {
  return (
    <Suspense>
      <ConversationsInner {...props} />
    </Suspense>
  );
}
