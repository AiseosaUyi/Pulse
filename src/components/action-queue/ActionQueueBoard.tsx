"use client";

// The Action Queue — the body of /dashboard. Polls /api/action-queue every
// 20s, same cadence/shape as ConversationsInbox.tsx's list poll, so two
// browsers on the same tenant converge on a resolve/claim within one cycle.

import { useCallback, useEffect, useState } from "react";
import type { ListActionQueueResult, QueueGroupKey } from "@/lib/services/action-queue";
import type { TenantMemberSummary } from "@/lib/services/team";
import { QueueGroup } from "./QueueGroup";
import { QueueFilters, type QueueFilterState } from "./QueueFilters";

const POLL_MS = 20000;

const DEFAULT_ORDER: QueueGroupKey[] = [
  "needs_reply",
  "needs_decision",
  "follow_ups_due",
  "going_cold",
  "opportunities",
];

export function ActionQueueBoard({
  initial,
  currentUserId,
  members,
  visibleGroups,
}: {
  initial: ListActionQueueResult;
  currentUserId: string;
  members: TenantMemberSummary[];
  /** Role gating (support): restrict which groups render. Undefined = all. */
  visibleGroups?: QueueGroupKey[];
}) {
  const [result, setResult] = useState(initial);
  const [filter, setFilter] = useState<QueueFilterState>({ platform: "", kind: "", assignedTo: "everyone" });
  const [showResolved, setShowResolved] = useState(false);

  const fetchQueue = useCallback(
    async (silent: boolean) => {
      const params = new URLSearchParams();
      if (!silent && showResolved) params.set("status", "resolved");
      if (filter.platform) params.set("platform", filter.platform);
      if (filter.kind) params.set("kind", filter.kind);
      if (filter.assignedTo !== "everyone") params.set("assignedTo", filter.assignedTo === "me" ? "me" : "unassigned");

      try {
        const res = await fetch(`/api/action-queue?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ListActionQueueResult;
        setResult(data);
      } catch {
        // Best-effort — keep showing the last good state.
      }
    },
    [filter, showResolved]
  );

  useEffect(() => {
    fetchQueue(false);
  }, [fetchQueue]);

  useEffect(() => {
    if (showResolved) return;
    const iv = setInterval(() => fetchQueue(true), POLL_MS);
    return () => clearInterval(iv);
  }, [fetchQueue, showResolved]);

  const orderedGroups = showResolved
    ? result.groups
    : DEFAULT_ORDER.map((key) => result.groups.find((g) => g.key === key)).filter((g): g is NonNullable<typeof g> => !!g);

  const groups = visibleGroups ? orderedGroups.filter((g) => visibleGroups.includes(g.key)) : orderedGroups;
  const allEmpty = groups.every((g) => g.count === 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-foreground">Action queue</h2>
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          className="text-xs text-primary-500 hover:underline"
        >
          {showResolved ? "Back to queue" : "Resolved today"}
        </button>
      </div>

      {!showResolved && <QueueFilters value={filter} onChange={setFilter} />}

      {allEmpty ? (
        <p className="py-8 text-center text-sm text-text-secondary">
          {showResolved ? "Nothing resolved yet." : "Nothing needs attention right now."}
        </p>
      ) : (
        <div>
          {groups.map((group) => (
            <QueueGroup
              key={group.key}
              group={group}
              currentUserId={currentUserId}
              members={members}
              onChanged={() => fetchQueue(true)}
              defaultOpen={group.key === "needs_reply" || group.key === "resolved"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
