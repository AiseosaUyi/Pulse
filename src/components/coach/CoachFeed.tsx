"use client";

// Dashboard widget — "Your AI team is working on" — surfaces the
// top N pending coach actions and lets the user advance them.

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Loader2,
  Sparkles,
  Clock,
  X,
  Plus,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDialogs } from "@/components/ui/Dialog";
import {
  coachForPrompt,
  deleteCoachAction,
  updateCoachActionStatus,
} from "@/lib/actions/coach";
import type { CoachActionRecord } from "@/lib/types/coach";

const PRIORITY_BADGES: Record<1 | 2 | 3, { label: string; cls: string }> = {
  1: { label: "Today", cls: "bg-status-red/10 text-status-red" },
  2: { label: "This week", cls: "bg-status-yellow/10 text-status-yellow" },
  3: { label: "This month", cls: "bg-sidebar text-text-muted" },
};

export function CoachFeed({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: CoachActionRecord[];
}) {
  const dialogs = useDialogs();
  const [actions, setActions] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAsking, startAsk] = useTransition();

  const visible = actions.filter(
    (a) => a.status === "pending" || a.status === "in_progress"
  );

  const handleStatus = (
    action: CoachActionRecord,
    status: "done" | "dismissed" | "in_progress" | "snoozed"
  ) => {
    setBusyId(action.id);
    setError(null);
    (async () => {
      const snoozedUntil =
        status === "snoozed"
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : null;
      const res = await updateCoachActionStatus(
        tenantSlug,
        action.id,
        status,
        snoozedUntil
      );
      setBusyId(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      if (status === "done" || status === "dismissed" || status === "snoozed") {
        setActions((prev) => prev.filter((a) => a.id !== action.id));
      } else {
        setActions((prev) =>
          prev.map((a) => (a.id === action.id ? { ...a, status } : a))
        );
      }
    })();
  };

  const handleDelete = async (action: CoachActionRecord) => {
    const ok = await dialogs.confirm({
      title: "Delete this action?",
      subtitle: "Removed permanently. Use Dismiss if you want to keep a record.",
      tone: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusyId(action.id);
    const res = await deleteCoachAction(tenantSlug, action.id);
    setBusyId(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setActions((prev) => prev.filter((a) => a.id !== action.id));
  };

  const handleAsk = () => {
    if (!prompt.trim()) return;
    setError(null);
    startAsk(async () => {
      const res = await coachForPrompt(tenantSlug, prompt.trim());
      if (!res.success) {
        setError(res.error);
        return;
      }
      setPrompt("");
      setAskOpen(false);
      // Actions are revalidated server-side; reload for simplicity.
      location.reload();
    });
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-5">
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center">
            <Sparkles size={14} />
          </div>
          <div className="min-w-0">
            <h2 className="text-foreground font-semibold text-sm">
              Your AI team is working on
            </h2>
            <p className="text-[11px] text-text-muted truncate">
              {visible.length > 0
                ? `${visible.length} action${visible.length === 1 ? "" : "s"} in the queue`
                : "No pending actions — ask the coach below"}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAskOpen((v) => !v)}
          className="gap-1.5"
        >
          <Plus size={14} />
          Ask coach
        </Button>
      </header>

      {askOpen && (
        <div className="mb-4 rounded-lg border border-border/60 p-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Our instagram engagement dropped 40% this week — what should we do?"
            rows={3}
            disabled={isAsking}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAskOpen(false)}
              disabled={isAsking}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAsk}
              disabled={isAsking || !prompt.trim()}
              className="gap-1.5"
            >
              {isAsking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Generate actions
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          className="mb-3 rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-xs text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-5 text-center">
          <p className="text-sm text-foreground font-semibold">
            Coach inbox clear.
          </p>
          <p className="text-xs text-text-muted mt-1">
            The coach auto-generates actions when you save a blog, run an audit,
            or ask it below.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((action) => {
            const badge = PRIORITY_BADGES[action.priority];
            const busy = busyId === action.id;
            return (
              <li
                key={action.id}
                className="rounded-lg border border-border/60 p-3 hover:border-border transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">
                    {action.status === "in_progress" ? (
                      <CircleDot size={14} className="text-primary-500" />
                    ) : (
                      <CircleDot size={14} className="text-text-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground leading-snug">
                        {action.title}
                      </h3>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-1 leading-relaxed">
                      {action.description}
                    </p>
                    <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide text-text-muted">
                        {action.impactArea}
                      </span>
                      {action.actionHref ? (
                        <Link
                          href={action.actionHref}
                          onClick={() => handleStatus(action, "in_progress")}
                          className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600 px-2 py-1 rounded-md bg-primary-500/5"
                        >
                          {action.ctaLabel}
                          <ChevronRight size={11} />
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleStatus(action, "done")}
                        disabled={busy}
                        title="Mark done"
                        className="inline-flex items-center gap-1 text-[11px] text-status-green hover:text-status-green px-2 py-1 rounded-md hover:bg-status-green/10"
                      >
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        Done
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatus(action, "snoozed")}
                        disabled={busy}
                        title="Snooze 24h"
                        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-2 py-1 rounded-md hover:bg-sidebar"
                      >
                        <Clock size={11} />
                        Snooze
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(action)}
                        disabled={busy}
                        title="Delete"
                        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-status-red px-2 py-1 rounded-md hover:bg-status-red/10 ml-auto"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
