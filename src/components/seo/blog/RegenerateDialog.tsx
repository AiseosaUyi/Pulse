"use client";

// Confirmation modal for the regenerate flow.
//
// Two UX commitments:
//   1. AI score suggestions go into the prompt via a clear checkbox
//      (defaults ON when current score < 90).
//   2. Below-90 outputs are rejected rather than silently persisted.
//      The dialog flips into a rejection panel with three paths:
//      retry-with-suggestions, apply-anyway (force), or tweak.
//
// Under the hood: the iterate-to-90 loop is chunked via
// `startRegeneration` + `advanceRegeneration`. Each advance call is
// one AI step (~20-30s) to stay under Vercel Hobby's 60s function
// cap. The client loops awaiting each advance and renders live
// progress so the ~100s total isn't a blank spinner.

import { useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Loader2,
  Sparkles,
  Shield,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  startRegeneration,
  advanceRegeneration,
  cancelRegeneration,
} from "@/lib/actions/blog-regeneration";
import type {
  BlogPostRecord,
  BlogScoreIssue,
  RegenerationState,
} from "@/lib/types/blog-posts";

function buildAiSuggestionsBlock(issues: BlogScoreIssue[]): string {
  if (issues.length === 0) return "";
  const top = issues
    .filter((i) => i.severity === "high" || i.severity === "med")
    .slice(0, 6);
  if (top.length === 0) return "";
  return [
    "The last score flagged these issues — fix them:",
    ...top.map(
      (i, idx) =>
        `${idx + 1}. [${i.severity.toUpperCase()} · ${i.subScore}] ${i.message}\n   Fix: ${i.suggestedFix}`
    ),
  ].join("\n\n");
}

/** Human labels for the state-machine phases shown during runs. */
const PHASE_LABEL: Record<RegenerationState["phase"], string> = {
  starting: "Starting…",
  scored: "Scored · deciding next pass",
  refine_done: "Refined · scoring",
  ok: "Done",
  below_threshold: "Rejected · below 90",
  failed: "Failed",
};

interface Props {
  post: BlogPostRecord;
  /** Feedback carried over from the dock (typed + transcribed). */
  initialFeedback: string;
  onClose: () => void;
  onSuccess: (note: string) => void;
}

type ViewPhase =
  | { kind: "compose" }
  | { kind: "running"; live: RegenerationState | null }
  | {
      kind: "rejected";
      score: number;
      issues: BlogScoreIssue[];
    };

const MAX_TOTAL_STEPS = 8; // initial-score + 3×(refine-score) pairs.

export function RegenerateDialog({
  post,
  initialFeedback,
  onClose,
  onSuccess,
}: Props) {
  const actionableIssueCount = post.scoreIssues.filter(
    (i) => i.severity === "high" || i.severity === "med"
  ).length;

  const defaultUseAi =
    (post.contentScore != null && post.contentScore < 90) ||
    actionableIssueCount > 0;

  const [feedback, setFeedback] = useState(initialFeedback.trim());
  const [useAiSuggestions, setUseAiSuggestions] = useState(defaultUseAi);
  const [view, setView] = useState<ViewPhase>({ kind: "compose" });
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Abort flag — set when user clicks Cancel during a run so the
  // poll loop knows to stop even if an AI call is still in flight.
  const abortRef = useRef(false);

  const composedContext = useMemo(() => {
    const pieces: string[] = [];
    if (feedback.trim()) pieces.push(feedback.trim());
    if (useAiSuggestions) {
      const ai = buildAiSuggestionsBlock(post.scoreIssues);
      if (ai) pieces.push(ai);
    }
    return pieces.join("\n\n---\n\n");
  }, [feedback, useAiSuggestions, post.scoreIssues]);

  const runLoop = async (opts: { force?: boolean } = {}) => {
    setError(null);
    abortRef.current = false;
    setView({ kind: "running", live: null });

    const start = await startRegeneration(post.id, post.tenantSlug, {
      extraFeedback: composedContext || undefined,
      force: opts.force,
    });
    if (!start.success) {
      setError(start.error);
      setView({ kind: "compose" });
      return;
    }

    let current: RegenerationState = start.state;
    setView({ kind: "running", live: current });

    // Poll by awaiting each step. Safety cap: MAX_TOTAL_STEPS to
    // avoid runaway loops if the state machine ever cycles without
    // making progress.
    for (let step = 0; step < MAX_TOTAL_STEPS; step++) {
      if (abortRef.current) {
        await cancelRegeneration(post.id, post.tenantSlug);
        setView({ kind: "compose" });
        return;
      }

      const res = await advanceRegeneration(post.id, post.tenantSlug);
      if (!res.success) {
        setError(res.error);
        setView({ kind: "compose" });
        return;
      }
      current = res.state;
      setView({ kind: "running", live: current });

      if (current.phase === "ok") {
        onSuccess(
          current.score
            ? `Regenerated · score ${current.score.total}`
            : "Regenerated"
        );
        return;
      }
      if (current.phase === "below_threshold") {
        setView({
          kind: "rejected",
          score: current.rejected_score ?? current.score?.total ?? 0,
          issues: (current.rejected_issues ?? current.score?.issues ?? []) as BlogScoreIssue[],
        });
        return;
      }
      if (current.phase === "failed") {
        setError(current.error ?? "Regeneration failed");
        setView({ kind: "compose" });
        return;
      }
    }

    setError(
      "Reached step cap without a terminal state. State may be corrupt — cancel and retry."
    );
    setView({ kind: "compose" });
  };

  const submit = (opts: { force?: boolean } = {}) =>
    startTransition(async () => {
      try {
        await runLoop(opts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regenerate failed");
        setView({ kind: "compose" });
      }
    });

  const handleRetryWithSuggestions = () => {
    setUseAiSuggestions(true);
    submit();
  };

  const handleApplyAnyway = () => {
    if (
      !window.confirm(
        "This regeneration scored below 90. Apply it anyway? The old draft is archived to history."
      )
    )
      return;
    submit({ force: true });
  };

  const handleCancel = () => {
    if (view.kind === "running") {
      abortRef.current = true;
    } else {
      onClose();
    }
  };

  const isRunning = view.kind === "running";
  const isRejected = view.kind === "rejected";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunning) onClose();
      }}
    >
      <div className="bg-card w-full max-w-[640px] rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-border/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary-500" />
            <h2 className="text-foreground font-semibold">Regenerate post</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isRunning}
            className="text-text-muted hover:text-foreground p-1 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Current score */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-sidebar/40 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                Current score
              </p>
              <p className="text-foreground font-semibold text-xl">
                {post.contentScore ?? "—"}
                <span className="text-text-muted text-xs ml-1">/100</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                Target
              </p>
              <p className="text-status-green font-semibold text-xl">90+</p>
            </div>
          </div>

          {isRejected ? (
            <RejectedPanel
              score={(view as { kind: "rejected"; score: number }).score}
              issues={(view as { kind: "rejected"; issues: BlogScoreIssue[] }).issues}
              onRetryWithSuggestions={handleRetryWithSuggestions}
              onApplyAnyway={handleApplyAnyway}
              onTweak={() => setView({ kind: "compose" })}
            />
          ) : isRunning ? (
            <RunningPanel live={(view as { kind: "running"; live: RegenerationState | null }).live} />
          ) : (
            <>
              {/* AI suggestions checkbox */}
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-sidebar/40 transition-colors">
                <input
                  type="checkbox"
                  checked={useAiSuggestions}
                  onChange={(e) => setUseAiSuggestions(e.target.checked)}
                  disabled={actionableIssueCount === 0}
                  className="mt-0.5 h-4 w-4 accent-primary-500"
                />
                <div className="flex-1">
                  <p className="text-sm text-foreground font-medium">
                    Use AI score suggestions as feedback
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {actionableIssueCount > 0
                      ? `Include the ${Math.min(
                          actionableIssueCount,
                          6
                        )} top high/medium-severity issues from the last score in the prompt.`
                      : "No actionable AI issues to include — the current score is already clean."}
                  </p>
                </div>
              </label>

              {/* Feedback textarea */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="regen-feedback"
                    className="text-sm text-foreground font-medium"
                  >
                    Your feedback
                    <span className="text-[11px] text-text-muted font-normal ml-2">
                      (optional · anything you want the rewrite to consider)
                    </span>
                  </label>
                </div>
                <Textarea
                  id="regen-feedback"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  placeholder="e.g. Make the intro punchier. Drop the &quot;10 steps&quot; framing. Add a section on pricing."
                />
              </div>

              {error && (
                <p
                  className="text-sm text-red-500 flex items-center gap-1"
                  role="alert"
                >
                  <AlertTriangle size={13} />
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {!isRejected && (
          <div className="p-5 border-t border-border/30 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={handleCancel}>
              {isRunning ? "Abort" : "Cancel"}
            </Button>
            <Button onClick={() => submit()} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Regenerate
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RunningPanel({ live }: { live: RegenerationState | null }) {
  const phase = live?.phase ?? "starting";
  const passCount = live?.passes?.length ?? 0;
  const refineCount = live?.refine_count ?? 0;
  const currentScore = live?.score?.total ?? null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-sidebar/40 p-4 flex items-start gap-3">
        <Loader2 size={18} className="animate-spin text-primary-500 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground font-medium">
            {PHASE_LABEL[phase]}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            Each step is one AI call (~20-30s). The full loop runs in chunks so
            it fits under the serverless function cap.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Passes" value={passCount} />
        <Stat
          label="Refines"
          value={`${refineCount}/3`}
          tone={refineCount >= 3 ? "warn" : undefined}
        />
        <Stat
          label="Score"
          value={currentScore != null ? `${currentScore}/100` : "—"}
          tone={
            currentScore == null
              ? undefined
              : currentScore >= 90
                ? "good"
                : currentScore >= 80
                  ? "warn"
                  : "bad"
          }
        />
      </div>

      {live?.passes && live.passes.length > 0 && (
        <ul className="space-y-1">
          {live.passes.map((p, i) => (
            <li
              key={i}
              className="text-[11px] text-text-muted flex items-center justify-between px-2 py-1 rounded bg-sidebar/30"
            >
              <span>
                #{i + 1} · {p.kind} · {p.word_count}w
              </span>
              <span>
                {Math.round(p.duration_ms / 1000)}s · ${p.cost_usd.toFixed(3)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-status-green"
      : tone === "warn"
        ? "text-status-yellow"
        : tone === "bad"
          ? "text-status-red"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
        {label}
      </p>
      <p className={`text-sm font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function RejectedPanel({
  score,
  issues,
  onRetryWithSuggestions,
  onApplyAnyway,
  onTweak,
}: {
  score: number;
  issues: BlogScoreIssue[];
  onRetryWithSuggestions: () => void;
  onApplyAnyway: () => void;
  onTweak: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-status-yellow/30 bg-status-yellow/10 p-4">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-status-yellow mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground font-medium">
              Regeneration rejected — best score was {score}/100.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Your current draft is untouched. Below-90 outputs aren&apos;t
              persisted by default so a bad regen can&apos;t overwrite a
              better draft.
            </p>
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
            What held it back
          </p>
          <ul className="space-y-1.5">
            {issues.slice(0, 4).map((iss, i) => (
              <li
                key={i}
                className="rounded-md border border-border p-2.5 text-xs text-foreground"
              >
                <span
                  className={`text-[9px] uppercase font-semibold mr-1.5 px-1 py-0.5 rounded ${
                    iss.severity === "high"
                      ? "bg-status-red/15 text-status-red"
                      : iss.severity === "med"
                        ? "bg-status-yellow/15 text-status-yellow"
                        : "bg-sidebar text-text-muted"
                  }`}
                >
                  {iss.severity}
                </span>
                {iss.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Button variant="ghost" onClick={onTweak}>
          Tweak feedback
        </Button>
        <Button variant="ghost" onClick={onApplyAnyway}>
          Apply anyway
        </Button>
        <Button onClick={onRetryWithSuggestions}>
          <Sparkles size={14} />
          Retry with AI suggestions
        </Button>
      </div>
    </div>
  );
}
