"use client";

import { useState, useTransition } from "react";
import {
  MessageCircle,
  Calendar,
  AlertCircle,
  Flame,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils/format";
import {
  snoozeFollowUp,
  clearFollowUp,
  analyzeProspectConversation,
} from "@/lib/actions/conversation-intelligence";
import type { OutreachTodayData, ProspectWithFollowUp } from "@/lib/services/outreach-intelligence";
import { PLATFORM_LABELS } from "@/lib/types/outbound";
import type { ProspectRecord } from "@/lib/types/outbound";

const SNOOZE_OPTIONS = [
  { label: "+3 days", days: 3 },
  { label: "+7 days", days: 7 },
  { label: "+14 days", days: 14 },
];

// Stable snapshot of "now" so these helpers are called at module-load time
// only, not during render (satisfies the React Compiler purity requirement).
const NOW_MS = new Date().getTime();

function relativeTime(iso: string): string {
  const diff = NOW_MS - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function daysSince(iso: string): number {
  return Math.floor((NOW_MS - new Date(iso).getTime()) / 86_400_000);
}

// ── Overdue / Follow-up row ──────────────────────────────────────────────────

function FollowUpRow({
  prospect,
  tenantSlug,
  tone,
  onOpenThread,
}: {
  prospect: ProspectWithFollowUp;
  tenantSlug: string;
  tone: "overdue" | "due";
  onOpenThread: (p: ProspectRecord) => void;
}) {
  const [done, setDone] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [isPending, start] = useTransition();

  const handleSnooze = (days: number) => {
    setSnoozeOpen(false);
    start(async () => {
      await snoozeFollowUp(tenantSlug, prospect.id, days);
    });
  };

  const handleDone = () => {
    start(async () => {
      await clearFollowUp(tenantSlug, prospect.id);
      setDone(true);
    });
  };

  if (done) return null;

  const daysOverdue = prospect.followUpAt ? daysSince(prospect.followUpAt) : 0;

  return (
    <li
      className={`flex items-start gap-3 py-3 border-b border-border/30 last:border-0 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="h-8 w-8 rounded-full bg-sidebar flex items-center justify-center shrink-0 text-[11px] font-bold text-text-muted uppercase">
        {prospect.handle.slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            @{prospect.handle}
          </span>
          <span className="text-xs uppercase tracking-wide text-text-muted">
            {PLATFORM_LABELS[prospect.platform]}
          </span>
          {tone === "overdue" && daysOverdue > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-status-red/10 text-status-red">
              {daysOverdue}d overdue
            </span>
          )}
        </div>
        {prospect.followUpNote && (
          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
            {prospect.followUpNote}
          </p>
        )}
        {prospect.followUpAt && (
          <p className="text-xs text-text-muted mt-0.5">
            {formatDateTime(prospect.followUpAt)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        <button
          type="button"
          onClick={() => onOpenThread(prospect)}
          className="text-[11px] text-primary-500 hover:text-primary-600 px-2 py-1.5 rounded hover:bg-primary-500/10"
        >
          View thread
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSnoozeOpen((v) => !v)}
            disabled={isPending}
            className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-2 py-1.5 rounded hover:bg-sidebar h-9"
          >
            {isPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <>
                <Clock size={11} />
                Snooze
                <ChevronDown size={9} />
              </>
            )}
          </button>
          {snoozeOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-36 rounded-lg border border-border bg-card shadow-lg py-1 animate-popover-in">
              {SNOOZE_OPTIONS.map((o) => (
                <button
                  key={o.days}
                  type="button"
                  onClick={() => handleSnooze(o.days)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-sidebar text-foreground"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleDone}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-status-green hover:bg-status-green/10 px-2 py-1.5 rounded h-9"
        >
          <CheckCircle2 size={11} />
          Done
        </button>
      </div>
    </li>
  );
}

// ── New reply row ─────────────────────────────────────────────────────────────

function ReplyRow({
  reply,
  onOpenThread,
}: {
  reply: OutreachTodayData["newReplies"][number];
  onOpenThread: (p: ProspectRecord) => void;
}) {
  return (
    <li className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0">
      <div className="h-8 w-8 rounded-full bg-primary-500/10 flex items-center justify-center shrink-0">
        <MessageCircle size={13} className="text-primary-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            @{reply.prospect?.handle ?? "unknown"}
          </span>
          {reply.prospect && (
            <span className="text-xs uppercase tracking-wide text-text-muted">
              {PLATFORM_LABELS[reply.prospect.platform]}
            </span>
          )}
          <span className="text-xs text-text-muted ml-auto">
            {relativeTime(reply.receivedAt)}
          </span>
        </div>
        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
          {reply.body}
        </p>
      </div>
      {reply.prospect && (
        <button
          type="button"
          onClick={() => onOpenThread(reply.prospect!)}
          className="shrink-0 text-[11px] text-primary-500 hover:text-primary-600 px-2 py-1.5 rounded hover:bg-primary-500/10 h-9"
        >
          View thread →
        </button>
      )}
    </li>
  );
}

// ── Going cold row ─────────────────────────────────────────────────────────────

function GoingColdRow({
  prospect,
  tenantSlug,
  onOpenThread,
}: {
  prospect: ProspectWithFollowUp;
  tenantSlug: string;
  onOpenThread: (p: ProspectRecord) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [analyzing, startAnalyze] = useTransition();

  const handleAnalyze = () => {
    startAnalyze(async () => {
      await analyzeProspectConversation(tenantSlug, prospect.id, "manual");
      onOpenThread(prospect);
    });
  };

  if (dismissed) return null;

  const days = prospect.lastTouchedAt ? daysSince(prospect.lastTouchedAt) : "?";

  return (
    <li
      className={`flex items-start gap-3 py-3 border-b border-border/30 last:border-0 transition-opacity ${
        analyzing ? "opacity-60" : ""
      }`}
    >
      <div className="h-8 w-8 rounded-full bg-sidebar flex items-center justify-center shrink-0 text-[11px] font-bold text-text-muted uppercase">
        {prospect.handle.slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            @{prospect.handle}
          </span>
          <span className="text-xs uppercase tracking-wide text-text-muted">
            {PLATFORM_LABELS[prospect.platform]}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-sidebar text-text-muted">
            Sent {days}d ago
          </span>
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          No reply · no follow-up scheduled
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analyzing}
          className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600 px-2 py-1.5 rounded hover:bg-primary-500/10 h-9"
        >
          {analyzing ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Sparkles size={11} />
          )}
          Analyze
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[11px] text-text-muted hover:text-foreground px-2 py-1.5 rounded hover:bg-sidebar h-9"
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}

// ── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  title,
  count,
  tone,
  children,
  emptyIcon,
  emptyHeading,
  emptyBody,
}: {
  title: string;
  count: number;
  tone: "red" | "primary" | "yellow" | "muted";
  children: React.ReactNode;
  emptyIcon: React.ReactNode;
  emptyHeading: string;
  emptyBody: string;
}) {
  const headerTone = {
    red: "bg-status-red/5 text-status-red border-status-red/20",
    primary: "bg-primary-500/5 text-primary-500 border-primary-500/20",
    yellow: "bg-status-yellow/5 text-status-yellow border-status-yellow/20",
    muted: "bg-sidebar text-text-muted border-border/50",
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className={`px-4 py-2.5 border-b ${headerTone}`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          {title}
        </span>
        <span className="ml-2 text-xs">{count}</span>
      </div>
      {count === 0 ? (
        <div className="flex flex-col items-center py-8 gap-1.5">
          <div className="text-text-muted">{emptyIcon}</div>
          <p className="text-sm font-medium text-foreground">{emptyHeading}</p>
          <p className="text-xs text-text-muted">{emptyBody}</p>
        </div>
      ) : (
        <ul className="px-4">{children}</ul>
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function TodayView({
  data,
  tenantSlug,
  onOpenThread,
}: {
  data: OutreachTodayData;
  tenantSlug: string;
  onOpenThread: (prospect: ProspectRecord) => void;
}) {
  const totalCount =
    data.overdue.length +
    data.newReplies.length +
    data.dueToday.length +
    data.goingCold.length;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {data.overdue.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-status-red/10 text-status-red border border-status-red/20">
              <AlertCircle size={11} />
              {data.overdue.length} overdue
            </span>
          )}
          {data.newReplies.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-primary-500/10 text-primary-500 border border-primary-500/20">
              <MessageCircle size={11} />
              {data.newReplies.length} new {data.newReplies.length === 1 ? "reply" : "replies"}
            </span>
          )}
          {data.dueToday.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-sidebar text-text-muted border border-border/50">
              <Calendar size={11} />
              {data.dueToday.length} due today
            </span>
          )}
          {data.goingCold.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-sidebar text-text-muted border border-border/50">
              <Flame size={11} />
              {data.goingCold.length} going cold
            </span>
          )}
        </div>
      )}

      {/* 1 — Overdue */}
      <Section
        title="Overdue"
        count={data.overdue.length}
        tone="red"
        emptyIcon={<CheckCircle2 size={28} />}
        emptyHeading="Nothing overdue"
        emptyBody="You're on top of it."
      >
        {data.overdue.map((p) => (
          <FollowUpRow
            key={p.id}
            prospect={p}
            tenantSlug={tenantSlug}
            tone="overdue"
            onOpenThread={onOpenThread}
          />
        ))}
      </Section>

      {/* 2 — New Replies */}
      <Section
        title="New Replies"
        count={data.newReplies.length}
        tone="primary"
        emptyIcon={<MessageCircle size={28} />}
        emptyHeading="No new replies"
        emptyBody="Replies from the last 48 hours show here."
      >
        {data.newReplies.map((r) => (
          <ReplyRow
            key={r.id}
            reply={r}
            onOpenThread={onOpenThread}
          />
        ))}
      </Section>

      {/* 3 — Follow Up Today */}
      <Section
        title="Follow Up Today"
        count={data.dueToday.length}
        tone="muted"
        emptyIcon={<Calendar size={28} />}
        emptyHeading="Nothing due today"
        emptyBody="Follow-ups scheduled for tomorrow and beyond."
      >
        {data.dueToday.map((p) => (
          <FollowUpRow
            key={p.id}
            prospect={p}
            tenantSlug={tenantSlug}
            tone="due"
            onOpenThread={onOpenThread}
          />
        ))}
      </Section>

      {/* 4 — Going Cold */}
      <Section
        title="Going Cold"
        count={data.goingCold.length}
        tone="muted"
        emptyIcon={<Flame size={28} />}
        emptyHeading="All warm"
        emptyBody="No prospects going cold."
      >
        {data.goingCold.map((p) => (
          <GoingColdRow
            key={p.id}
            prospect={p}
            tenantSlug={tenantSlug}
            onOpenThread={onOpenThread}
          />
        ))}
      </Section>
    </div>
  );
}
