"use client";

// One row on the Action Queue board — three of the four layout variants
// from docs/ACTION-QUEUE-LAYOUT.md (compose/card/line; `chip` is its own
// component, GoingColdChip.tsx, since it needs shared selection state a
// single row can't own). Density is inverse to the work a row demands:
// `compose` gets a full card with a textarea; `card`/`line` get
// progressively less space for rows that only need recognizing, not
// composing.
//
// Colour carries urgency only — PRIORITY_TONE is the only place a border/
// background colour appears on this component, reused verbatim from
// needs-you/page.tsx's own PRIORITY_TONE so there's one urgency scale in
// the app, not two. No manual claim/snooze ceremony: every open/copy/
// resolve is logged instead (queue-activity.ts) so an owner/admin can see
// who handled what without a lock step.

import { useState, useTransition } from "react";
import { ExternalLink, Copy, Check, RotateCcw, History, ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";
import type { QueueRow, QueuePriority, QueueStatus } from "@/lib/services/action-queue";
import type { QueueActivityEntry } from "@/lib/services/queue-activity";
import { saveProposedReply, setRowStatus, logRowActivity, getRowActivity } from "@/lib/actions/action-queue";

export type QueueRowVariant = "compose" | "card" | "line";

// Same scale as needs-you/page.tsx's PRIORITY_TONE — one urgency palette
// for the whole app, not a second one invented here.
const PRIORITY_TONE: Record<QueuePriority, string> = {
  urgent: "border-status-red/30 bg-status-red/5",
  high: "border-status-yellow/30 bg-status-yellow/5",
  normal: "border-border bg-card",
  low: "border-border bg-card",
};

const AGE_SLA_MS = 48 * 60 * 60 * 1000; // matches outreach-intelligence.ts's own "isAging" threshold

const ACTIVITY_LABEL: Record<QueueActivityEntry["action"], string> = {
  opened: "opened",
  copied_reply: "copied the reply",
  resolved: "resolved",
  reopened: "reopened",
  dismissed: "dismissed",
  snoozed: "snoozed",
};

const UNSUPPORTED_SOURCES = new Set(["coach", "prospect"]);

export function QueueRowCard({
  row,
  variant = "compose",
  canSeeActivity,
  onChanged,
}: {
  row: QueueRow;
  variant?: QueueRowVariant;
  canSeeActivity: boolean;
  onChanged: () => void;
}) {
  const [, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState<QueueStatus | null>(null);
  const [replyDraft, setReplyDraft] = useState(row.proposedReply ?? "");
  const [copied, setCopied] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<QueueActivityEntry[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const rowRef = { source: row.source, id: row.id };
  const status = optimisticStatus ?? row.status;
  const isResolved = status === "resolved" || status === "dismissed";
  const overdue = !!row.dueAt && new Date(row.dueAt).getTime() < Date.now() && !isResolved;
  const aged = variant === "compose" && !isResolved && Date.now() - new Date(row.receivedAt).getTime() > AGE_SLA_MS;
  const canEditReply = !UNSUPPORTED_SOURCES.has(row.source);
  const message = row.source === "engagement" ? row.title : (row.body ?? row.title);
  const assignedToOther = !!row.assignedTo; // read-only signal now — no claim UI sets this, an agent might

  function applyStatus(next: QueueStatus) {
    const prev = status;
    setOptimisticStatus(next);
    setMenuOpen(false);
    startTransition(async () => {
      const res = await setRowStatus(rowRef, next, { contentSnapshot: message });
      if (!res.success) {
        setOptimisticStatus(prev);
        toast.error("Couldn't update", res.error);
      } else {
        toast.success(next === "resolved" ? "Resolved" : next === "dismissed" ? "Dismissed" : "Reopened");
        onChanged();
      }
    });
  }

  function handleView() {
    startTransition(() => logRowActivity(rowRef, "opened", message));
  }

  function copyReply() {
    if (!replyDraft) return;
    navigator.clipboard.writeText(replyDraft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      startTransition(() => logRowActivity(rowRef, "copied_reply", message));
    });
  }

  function handleReplyBlur() {
    if (replyDraft === (row.proposedReply ?? "") || !canEditReply) return;
    startTransition(async () => {
      const res = await saveProposedReply(rowRef, replyDraft);
      if (!res.success) toast.error("Couldn't save reply", res.error);
    });
  }

  function toggleActivity() {
    const next = !activityOpen;
    setActivityOpen(next);
    if (next && activity === null) {
      setActivityLoading(true);
      startTransition(async () => {
        const entries = await getRowActivity(rowRef);
        setActivity(entries);
        setActivityLoading(false);
      });
    }
  }

  const activityPanel = activityOpen && (
    <div className="mt-2 rounded-md bg-background/60 border border-border/40 px-2.5 py-2 space-y-1">
      {activityLoading && <p className="text-xs text-text-muted">Loading…</p>}
      {!activityLoading && activity?.length === 0 && <p className="text-xs text-text-muted">No activity yet.</p>}
      {!activityLoading &&
        activity?.map((entry) => (
          <p key={entry.id} className="text-xs text-text-secondary" suppressHydrationWarning>
            <span className="font-medium text-foreground">{entry.actorName ?? "Someone"}</span>{" "}
            {ACTIVITY_LABEL[entry.action]} · {formatRelativeTime(entry.createdAt)}
          </p>
        ))}
    </div>
  );

  const activityButton = canSeeActivity && (
    <Button variant="ghost" size="xs" onClick={toggleActivity}>
      <History size={12} />
      Activity
      <ChevronDown size={11} className={cn("transition-transform duration-200", activityOpen && "rotate-180")} />
    </Button>
  );

  // ── line: chore / follow_up — one row, minimal chrome ──────────────────
  if (variant === "line") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors",
          overdue ? "border-status-red/40" : "border-border/50 hover:border-border",
          assignedToOther && "opacity-60"
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-text-muted shrink-0" aria-hidden />
        <span className="flex-1 min-w-0 truncate text-foreground">{row.title}</span>
        <span className="shrink-0 text-[11px] text-text-muted" suppressHydrationWarning>{formatRelativeTime(row.receivedAt)}</span>
        {row.externalUrl && (
          <a
            href={row.externalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={handleView}
            className="shrink-0 text-xs font-medium text-primary-500 hover:underline whitespace-nowrap"
          >
            {row.actionLabel ?? "Open"}
          </a>
        )}
        {!isResolved && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              className="p-1 rounded text-text-muted hover:text-foreground hover:bg-card-hover"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[120px] rounded-lg border border-border bg-card shadow-xl py-1">
                <button
                  type="button"
                  onClick={() => applyStatus("resolved")}
                  className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-card-hover"
                >
                  Resolve
                </button>
                <button
                  type="button"
                  onClick={() => applyStatus("dismissed")}
                  className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-card-hover"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── card: decision / escalation / opportunity — title, why, one action ─
  if (variant === "card") {
    return (
      <div className={cn("rounded-lg border p-3 space-y-1.5", PRIORITY_TONE[row.priority], assignedToOther && "opacity-60")}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{row.title}</p>
          <span className="shrink-0 text-[11px] text-text-muted" suppressHydrationWarning>{formatRelativeTime(row.receivedAt)}</span>
        </div>
        {row.why && <p className="text-xs text-text-secondary">{row.why}</p>}
        <div className="flex items-center gap-1.5 pt-0.5">
          {row.externalUrl && (
            <Button asChild variant="tertiary" size="xs" onClick={handleView}>
              <a href={row.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={12} />
                {row.actionLabel ?? "Review"}
              </a>
            </Button>
          )}
          {!isResolved ? (
            <Button variant="ghost" size="xs" onClick={() => applyStatus("resolved")}>
              <Check size={12} />
              Resolve
            </Button>
          ) : (
            <Button variant="ghost" size="xs" onClick={() => applyStatus("open")}>
              <RotateCcw size={12} />
              Reopen
            </Button>
          )}
          {activityButton}
        </div>
        {activityPanel}
      </div>
    );
  }

  // ── compose: reply — full card, editable textarea ──────────────────────
  return (
    <div className={cn("rounded-lg border p-3 transition-colors", PRIORITY_TONE[row.priority], assignedToOther && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-foreground truncate">{row.fromName ?? row.title}</span>
        {row.platform && <span className="text-[11px] text-text-muted capitalize">{row.platform}</span>}
        {row.channel && row.channel !== "other" && (
          <span className="text-[11px] text-text-muted capitalize">· {row.channel}</span>
        )}
        <span className={cn("text-[11px]", aged ? "text-status-red font-medium" : "text-text-muted")} suppressHydrationWarning>
          · {formatRelativeTime(row.receivedAt)}
        </span>
        {overdue && <span className="text-[11px] font-medium text-status-red">· overdue</span>}
      </div>

      {row.why && <p className="mt-1 text-xs italic text-text-muted">{row.why}</p>}
      <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{message}</p>

      {canEditReply && (
        <textarea
          value={replyDraft}
          onChange={(e) => setReplyDraft(e.target.value)}
          onBlur={handleReplyBlur}
          placeholder="Draft a reply…"
          rows={2}
          className="mt-2 w-full rounded-md border border-border/60 bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 resize-none"
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {row.externalUrl && (
          <Button asChild variant="tertiary" size="xs" onClick={handleView}>
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
        {!isResolved ? (
          <Button variant="ghost" size="xs" onClick={() => applyStatus("resolved")}>
            <Check size={12} />
            Resolve
          </Button>
        ) : (
          <Button variant="ghost" size="xs" onClick={() => applyStatus("open")}>
            <RotateCcw size={12} />
            Reopen
          </Button>
        )}
        {activityButton}
      </div>
      {activityPanel}
    </div>
  );
}
