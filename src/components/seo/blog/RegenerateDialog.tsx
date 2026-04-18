"use client";

// Confirmation modal for the regenerate flow. Centralizes the two
// things the user asked for:
//
//   1. An explicit way to include AI score issues as feedback (not
//      just whatever the user typed / spoke). Checkbox defaults ON
//      when current score < 90 because that's when AI suggestions
//      have the most signal.
//   2. Graceful handling of the below-90 quality gate — instead of
//      silently persisting a worse result, the server rejects and
//      the dialog flips into a rejection state with three paths:
//      retry-with-suggestions, apply-anyway (force), or tweak.

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Loader2,
  Sparkles,
  Shield,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { regenerateBlogPost } from "@/lib/actions/blog-posts";
import type { BlogPostRecord, BlogScoreIssue } from "@/lib/types/blog-posts";

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

interface Props {
  post: BlogPostRecord;
  /** Feedback carried over from the dock (typed + transcribed). */
  initialFeedback: string;
  onClose: () => void;
  onSuccess: (note: string) => void;
}

type Phase =
  | { kind: "compose" }
  | { kind: "running" }
  | {
      kind: "rejected";
      score: number;
      issues: BlogScoreIssue[];
      feedbackUsed: string;
    };

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
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const composedContext = useMemo(() => {
    const pieces: string[] = [];
    if (feedback.trim()) pieces.push(feedback.trim());
    if (useAiSuggestions) {
      const ai = buildAiSuggestionsBlock(post.scoreIssues);
      if (ai) pieces.push(ai);
    }
    return pieces.join("\n\n---\n\n");
  }, [feedback, useAiSuggestions, post.scoreIssues]);

  const submit = (opts: { force?: boolean } = {}) => {
    setError(null);
    setPhase({ kind: "running" });
    startTransition(async () => {
      try {
        const res = await regenerateBlogPost(post.id, post.tenantSlug, {
          extraFeedback: composedContext || undefined,
          force: opts.force,
        });
        if (!res.success) throw new Error(res.error);

        if (res.scoreBelowThreshold && !opts.force) {
          setPhase({
            kind: "rejected",
            score: res.rejectedScore ?? 0,
            issues: (res.rejectedIssues ?? []) as BlogScoreIssue[],
            feedbackUsed: composedContext,
          });
          return;
        }

        onSuccess(
          res.contentScore != null
            ? `Regenerated · score ${res.contentScore}`
            : "Regenerated"
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regenerate failed");
        setPhase({ kind: "compose" });
      }
    });
  };

  const handleRetryWithSuggestions = () => {
    // Flip the checkbox on if it wasn't already and retry. If AI
    // suggestions were already on, this is a plain retry.
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

  const isRunning = phase.kind === "running";
  const isRejected = phase.kind === "rejected";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunning) onClose();
      }}
    >
      <div className="bg-card w-full max-w-[600px] rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh]">
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
          {/* Current score context */}
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
              phase={phase as Extract<Phase, { kind: "rejected" }>}
              onRetryWithSuggestions={handleRetryWithSuggestions}
              onApplyAnyway={handleApplyAnyway}
              onTweak={() => setPhase({ kind: "compose" })}
            />
          ) : (
            <>
              {/* AI suggestions checkbox */}
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-sidebar/40 transition-colors">
                <input
                  type="checkbox"
                  checked={useAiSuggestions}
                  onChange={(e) => setUseAiSuggestions(e.target.checked)}
                  disabled={isRunning || actionableIssueCount === 0}
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
                  disabled={isRunning}
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

              {isRunning && (
                <div className="rounded-lg border border-border bg-sidebar/40 p-4 flex items-center gap-3">
                  <Loader2
                    size={18}
                    className="animate-spin text-primary-500"
                  />
                  <div>
                    <p className="text-sm text-foreground">
                      Regenerating with iterate-to-90…
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Up to ~60s. Writing, scoring, and refining until it hits
                      90+ (or we stop because the budget's gone).
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!isRejected && (
          <div className="p-5 border-t border-border/30 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isRunning}>
              Cancel
            </Button>
            <Button onClick={() => submit()} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Regenerating…
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

function RejectedPanel({
  phase,
  onRetryWithSuggestions,
  onApplyAnyway,
  onTweak,
}: {
  phase: Extract<Phase, { kind: "rejected" }>;
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
              Regeneration rejected — best score was {phase.score}/100.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Your current draft is untouched. Below-90 outputs aren&apos;t
              persisted by default so a bad regen can&apos;t overwrite a
              better draft.
            </p>
          </div>
        </div>
      </div>

      {phase.issues.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
            What held it back
          </p>
          <ul className="space-y-1.5">
            {phase.issues.slice(0, 4).map((iss, i) => (
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
