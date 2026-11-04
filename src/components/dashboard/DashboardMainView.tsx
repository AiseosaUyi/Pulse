"use client";

import { useState } from "react";
import { Sparkles, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { MyDayView } from "@/components/dashboard/MyDayView";
import { ActionQueueBoard } from "@/components/action-queue/ActionQueueBoard";
import type { MyDayData } from "@/lib/services/my-day";
import type { QueueGroupKey, ListActionQueueResult } from "@/lib/services/action-queue";

type DashboardTab = "my_day" | "social_inbox";

export function DashboardMainView({
  myDayData,
  tenantSlug,
  currentUserName,
  queueResult,
  canSeeActivity,
  visibleGroups,
}: {
  myDayData: MyDayData;
  tenantSlug: string;
  currentUserName?: string | null;
  queueResult: ListActionQueueResult;
  canSeeActivity: boolean;
  visibleGroups?: QueueGroupKey[];
}) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("my_day");

  const myDayCount =
    myDayData.replyNow.length +
    myDayData.readyToSend.length +
    myDayData.followUpToday.length +
    myDayData.findContact.length;

  const socialInboxCount = (queueResult?.groups ?? []).reduce(
    (acc: number, g: { count: number }) => acc + (g.count || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("my_day")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors",
            activeTab === "my_day"
              ? "border-primary-500 text-foreground"
              : "border-transparent text-text-muted hover:text-foreground"
          )}
        >
          <Sparkles size={15} className={activeTab === "my_day" ? "text-primary-500" : "text-text-muted"} />
          <span>My day</span>
          {myDayCount > 0 && (
            <span
              className={cn(
                "ml-1 text-xs px-2 py-0.5 rounded-full font-bold",
                activeTab === "my_day"
                  ? "bg-primary-500/15 text-primary-500"
                  : "bg-sidebar text-text-muted"
              )}
            >
              {myDayCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("social_inbox")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors",
            activeTab === "social_inbox"
              ? "border-primary-500 text-foreground"
              : "border-transparent text-text-muted hover:text-foreground"
          )}
        >
          <Inbox size={15} className={activeTab === "social_inbox" ? "text-primary-500" : "text-text-muted"} />
          <span>Social inbox</span>
          {socialInboxCount > 0 && (
            <span
              className={cn(
                "ml-1 text-xs px-2 py-0.5 rounded-full font-bold",
                activeTab === "social_inbox"
                  ? "bg-primary-500/15 text-primary-500"
                  : "bg-sidebar text-text-muted"
              )}
            >
              {socialInboxCount}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === "my_day" ? (
        <MyDayView
          initialData={myDayData}
          tenantSlug={tenantSlug}
          currentUserName={currentUserName}
        />
      ) : (
        <ActionQueueBoard
          initial={queueResult}
          canSeeActivity={canSeeActivity}
          visibleGroups={visibleGroups}
        />
      )}
    </div>
  );
}
