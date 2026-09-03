"use client";

// One row on the Action Queue board. Optimistic-update pattern copied
// exactly from ThreadPanel.tsx's handleAssignToggle/handleStatusToggle:
// local `optimistic` override merged over server state via `displayed()`,
// applied immediately, rolled back + toast.error() on failure.

import { useState, useTransition } from "react";
import { ExternalLink, Copy, Check, Clock3, UserPlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";
import type { QueueRow, QueuePriority, QueueStatus } from "@/lib/services/action-queue";
import type { TenantMemberSummary } from "@/lib/services/team";
import { saveProposedReply, setRowStatus, claimRow } from "@/lib/actions/action-queue";

const PRIORITY_STYLE: Record<QueuePriority, string> = {
  urgent: "bg-status-red/10 text-status-red",
  high: "bg-status-yellow/10 text-status-yellow",
  normal: "bg-border/50 text-text-secondary",
  low: "bg-border/30 text-text-muted",
};

const SNOOZE_OPTIONS: Array<{ label: string; getUntil: () => Date }> = [
  { label: "1 hour", getUntil: () => new Date(Date.now() + 60 * 60 * 1000) },
  {
    label: "Tonight",
    getUntil: () => {
      const d = new Date();
      d.setHours(20, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    label: "Tomorrow",
    getUntil: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Next week",
    getUntil: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

const UNSUPPORTED_SOURCES = new Set(["coach", "prospect"]);

export function QueueRowCard({
  row,
  currentUserId,
  members,
  onChanged,
}: {
  row: QueueRow;
  currentUserId: string;
  members: TenantMemberSummary[];
  onChanged: () => void;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<{ status?: QueueStatus; assignedTo?: string | null } | null>(null);
  const [replyDraft, setReplyDraft] = useState(row.proposedReply ?? "");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const rowRef = { source: row.source, id: row.id };
  const status = optimistic?.status ?? row.status;
  const assignedTo = optimistic?.assignedTo !== undefined ? optimistic.assignedTo : row.assignedTo;
  const isMine = assignedTo === currentUserId;
  const isResolved = status === "resolved" || status === "dismissed";
  const overdue = !!row.dueAt && new Date(row.dueAt).getTime() < Date.now() && !isResolved;
  const canEditReply = !UNSUPPORTED_SOURCES.has(row.source);
  const assigneeName = assignedTo ? members.find((m) => m.userId === assignedTo)?.displayName ?? "Someone" : null;

  function applyStatus(next: QueueStatus, opts?: { snoozedUntil?: string }) {
    const prev = status;
    setOptimistic((o) => ({ ...o, status: next }));
    startTransition(async () => {
      const res = await setRowStatus(rowRef, next, opts);
      if (!res.success) {
        setOptimistic((o) => ({ ...o, status: prev }));
        toast.error("Couldn't update", res.error);
      } else {
        toast.success(next === "resolved" ? "Resolved" : next === "snoozed" ? "Snoozed" : "Updated");
        onChanged();
      }
    });
  }

  function claim() {
    const prev = assignedTo;
    setOptimistic((o) => ({ ...o, assignedTo: currentUserId }));
    startTransition(async () => {
      const res = await claimRow(rowRef, currentUserId);
      if (!res.success) {
        setOptimistic((o) => ({ ...o, assignedTo: prev }));
        toast.error("Couldn't claim", res.error);
      } else {
        onChanged();
      }
    });
  }

  function release() {
    const prev = assignedTo;
    setOptimistic((o) => ({ ...o, assignedTo: null }));
    startTransition(async () => {
      const res = await claimRow(rowRef, null);
      if (!res.success) {
        setOptimistic((o) => ({ ...o, assignedTo: prev }));
        toast.error("Couldn't unassign", res.error);
      } else {
        onChanged();
      }
    });
  }

  function handleReplyFocus() {
    if (!assignedTo) claim();
  }

  function handleReplyBlur() {
    if (replyDraft === (row.proposedReply ?? "") || !canEditReply) return;
    startTransition(async () => {
      const res = await saveProposedReply(rowRef, replyDraft);
      if (!res.success) toast.error("Couldn't save reply", res.error);
    });
  }

  function copyReply() {
    if (!replyDraft) return;
    navigator.clipboard.writeText(replyDraft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const message = row.source === "engagement" ? row.title : (row.body ?? row.title);
  const claimedByOther = !!assignedTo && !isMine;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        overdue ? "border-status-red/40" : "border-border/60 hover:border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar url={null} name={row.fromName ?? row.title} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground truncate">
              {row.fromName ?? row.title}
            </span>
            {row.platform && (
              <span className="text-[11px] text-text-muted capitalize">{row.platform}</span>
            )}
            {row.channel && row.channel !== "other" && (
              <span className="text-[11px] text-text-muted capitalize">· {row.channel}</span>
            )}
            <span className="text-[11px] text-text-muted">· {formatRelativeTime(row.receivedAt)}</span>
            {overdue && (
              <span className="text-[11px] font-medium text-status-red">· overdue</span>
            )}
            <span className={cn("ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full", PRIORITY_STYLE[row.priority])}>
              {row.priority}
            </span>
          </div>

          {row.why && <p className="mt-1 text-xs italic text-text-muted">{row.why}</p>}
          <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{message}</p>

          {canEditReply && (
            <div className="mt-2">
              {claimedByOther ? (
                <button
                  type="button"
                  onClick={claim}
                  className="w-full text-left text-xs text-text-muted italic rounded-md border border-dashed border-border/60 px-2.5 py-2 hover:border-border"
                >
                  Claimed by {assigneeName} — click to take over
                </button>
              ) : (
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  onFocus={handleReplyFocus}
                  onBlur={handleReplyBlur}
                  placeholder="Draft a reply…"
                  rows={2}
                  className="w-full rounded-md border border-border/60 bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 resize-none"
                />
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {row.externalUrl && (
              <Button asChild variant="tertiary" size="xs">
                <a href={row.externalUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} />
                  {row.actionLabel ?? "Open"}
                </a>
              </Button>
            )}
            {replyDraft && (
              <Button variant="ghost" size="xs" onClick={copyReply}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy reply"}
              </Button>
            )}
            {!isResolved && (
              <Button variant="ghost" size="xs" onClick={() => applyStatus("resolved")}>
                <Check size={12} />
                Resolve
              </Button>
            )}
            {isResolved && (
              <Button variant="ghost" size="xs" onClick={() => applyStatus("open")}>
                <RotateCcw size={12} />
                Reopen
              </Button>
            )}
            <div className="relative">
              <Button variant="ghost" size="xs" onClick={() => setSnoozeOpen((v) => !v)}>
                <Clock3 size={12} />
                Snooze
              </Button>
              {snoozeOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-xl py-1">
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        setSnoozeOpen(false);
                        applyStatus("snoozed", { snoozedUntil: opt.getUntil().toISOString() });
                      }}
                      className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-card-hover"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isMine ? (
              <Button variant="ghost" size="xs" onClick={release}>
                Unassign
              </Button>
            ) : (
              !claimedByOther && (
                <Button variant="ghost" size="xs" onClick={claim}>
                  <UserPlus size={12} />
                  Assign to me
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
