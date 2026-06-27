"use client";

import { useRef, useState, useTransition } from "react";
import {
  Sparkles,
  Globe,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  startFullAudit,
  advanceFullAudit,
  cancelFullAudit,
  type AuditPhase,
  type AuditState,
} from "@/lib/actions/brand-audit";

const MAX_POLL_STEPS = 8;

const PHASE_STEPS: Array<{ key: AuditPhase | "starting"; label: string }> = [
  { key: "starting", label: "Reading your site" },
  { key: "voice_done", label: "Extracting your voice" },
  { key: "competitors_done", label: "Identifying competitors" },
  { key: "keywords_done", label: "Discovering keywords" },
  { key: "ok", label: "Drafting content briefs" },
];

function activeStepIndex(phase: AuditPhase): number {
  switch (phase) {
    case "starting": return 0;
    case "voice_done": return 1;
    case "competitors_done": return 2;
    case "keywords_done": return 3;
    case "ok": return PHASE_STEPS.length;
    case "failed": return -1;
  }
}

interface Props {
  tenantSlug: string;
  tenantName: string;
  currentUrl: string | null;
  lastAuditAt: string | null;
  hasBrandVoice: boolean;
  hasBrandPositioning: boolean;
  competitorCount: number;
  keywordCount: number;
  briefCount: number;
}

type ViewPhase =
  | { kind: "idle" }
  | { kind: "running"; live: AuditState | null }
  | { kind: "done"; state: AuditState }
  | { kind: "error"; message: string };

export function BrandAuditClient({
  tenantSlug,
  tenantName,
  currentUrl,
  lastAuditAt,
  hasBrandVoice,
  hasBrandPositioning,
  competitorCount,
  keywordCount,
  briefCount,
}: Props) {
  const [url, setUrl] = useState(currentUrl ?? "");
  const [view, setView] = useState<ViewPhase>({ kind: "idle" });
  const [showRerun, setShowRerun] = useState(!hasBrandVoice);
  const [, startTransition] = useTransition();
  const [isDownloading, setIsDownloading] = useState(false);
  const abortRef = useRef(false);

  const isRunning = view.kind === "running";

  const runLoop = async (initialUrl: string) => {
    abortRef.current = false;

    const startRes = await startFullAudit(tenantSlug, initialUrl);
    if (!startRes.success) {
      setView({ kind: "error", message: startRes.error });
      return;
    }

    let current: AuditState = startRes.state;
    setView({ kind: "running", live: current });

    for (let step = 0; step < MAX_POLL_STEPS; step++) {
      if (abortRef.current) {
        await cancelFullAudit(tenantSlug);
        setView({ kind: "idle" });
        return;
      }

      const res = await advanceFullAudit(tenantSlug);
      if (!res.success) {
        setView({ kind: "error", message: res.error });
        return;
      }
      current = res.state;
      setView({ kind: "running", live: current });

      if (current.phase === "ok") {
        setView({ kind: "done", state: current });
        return;
      }
      if (current.phase === "failed") {
        setView({ kind: "error", message: current.error ?? "Audit failed" });
        return;
      }
    }

    setView({ kind: "error", message: "Audit timed out — try again" });
  };

  const handleStart = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setView({ kind: "running", live: null });
    startTransition(() => { void runLoop(trimmed); });
  };

  const handleCancel = () => {
    abortRef.current = true;
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(
        `/api/brand-audit/export?tenant=${encodeURIComponent(tenantSlug)}`
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `brand-audit-${tenantSlug}-${new Date().toISOString().split("T")[0]}.md`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsDownloading(false);
    }
  };

  const livePhase =
    view.kind === "running" && view.live ? view.live.phase : null;
  const activeStep = livePhase ? activeStepIndex(livePhase) : -1;

  const hasSomeData = hasBrandVoice || hasBrandPositioning;

  return (
    <div className="space-y-6">
      {/* Current audit summary */}
      {hasSomeData && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Brand data overview
              </h2>
              {lastAuditAt && (
                <p className="text-xs text-text-muted mt-0.5">
                  Last audited:{" "}
                  {new Date(lastAuditAt).toLocaleDateString("en-GB", {
                    dateStyle: "long",
                  })}
                  {currentUrl && (
                    <span className="ml-1.5 text-text-muted/60">
                      · {currentUrl}
                    </span>
                  )}
                </p>
              )}
            </div>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border border-border text-text-muted hover:text-foreground hover:border-gray-400 disabled:opacity-60 transition-colors"
            >
              <Download size={12} />
              {isDownloading ? "Generating…" : "Download report"}
            </button>
          </div>

          {/* Data status pills */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Brand voice", ok: hasBrandVoice },
              { label: "Brand positioning", ok: hasBrandPositioning },
              {
                label: `${competitorCount} competitor${competitorCount !== 1 ? "s" : ""}`,
                ok: competitorCount > 0,
              },
              {
                label: `${keywordCount} keyword${keywordCount !== 1 ? "s" : ""}`,
                ok: keywordCount > 0,
              },
              {
                label: `${briefCount} brief${briefCount !== 1 ? "s" : ""}`,
                ok: briefCount > 0,
              },
            ].map(({ label, ok }) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-0.5 ${
                  ok
                    ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
                    : "bg-white-200 text-text-muted dark:bg-white/10"
                }`}
              >
                <CheckCircle2 size={10} />
                {label}
              </span>
            ))}
          </div>

          {/* Re-run toggle */}
          {!showRerun && (
            <button
              onClick={() => setShowRerun(true)}
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground transition-colors"
            >
              <RefreshCw size={11} />
              Re-run audit
              <ChevronDown size={11} />
            </button>
          )}
        </div>
      )}

      {/* Re-run form */}
      {(showRerun || !hasSomeData) && view.kind === "idle" && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles size={14} className="text-primary-500" />
                {hasSomeData ? "Re-run brand audit" : "Run brand audit"}
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                Scrapes your site and populates voice, positioning, competitors,
                keywords, and starter briefs. Takes about 60 seconds.
                {hasSomeData &&
                  " Existing data will be overwritten."}
              </p>
            </div>
            {hasSomeData && (
              <button
                onClick={() => setShowRerun(false)}
                className="text-text-muted/50 hover:text-text-muted transition-colors"
              >
                <ChevronUp size={14} />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/60"
              />
              <Input
                type="url"
                placeholder={`https://${tenantName.toLowerCase().replace(/\s+/g, "")}.com`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="pl-9 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
              />
            </div>
            <Button
              onClick={handleStart}
              disabled={!url.trim()}
              className="bg-primary-500 hover:bg-primary-600 text-white shrink-0"
            >
              Start audit
            </Button>
          </div>
        </div>
      )}

      {/* Running state */}
      {view.kind === "running" && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Auditing {tenantName}…
            </h2>
            <button
              onClick={handleCancel}
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="space-y-2">
            {PHASE_STEPS.map((step, i) => {
              const isActive = i === activeStep;
              const isDone = activeStep > i || view.kind !== "running" || (view.live?.phase === "ok");
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors ${
                      isDone
                        ? "bg-success-500 text-white"
                        : isActive
                        ? "bg-primary-500 text-white animate-pulse"
                        : "bg-white-200 dark:bg-white/10 text-text-muted"
                    }`}
                  >
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-sm transition-colors ${
                      isActive
                        ? "text-foreground font-medium"
                        : isDone
                        ? "text-text-muted line-through"
                        : "text-text-muted"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Done state */}
      {view.kind === "done" && (
        <div className="rounded-xl border border-success-500/30 bg-success-50/50 dark:bg-success-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-success-600 dark:text-success-400">
            <CheckCircle2 size={16} />
            <span className="text-sm font-semibold">Audit complete</span>
          </div>
          <p className="text-xs text-text-muted">
            Added {view.state.competitors_added} competitor
            {view.state.competitors_added !== 1 ? "s" : ""},{" "}
            {view.state.keywords_added} keyword
            {view.state.keywords_added !== 1 ? "s" : ""},{" "}
            {view.state.briefs_added} content brief
            {view.state.briefs_added !== 1 ? "s" : ""}.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
            >
              <Download size={11} />
              {isDownloading ? "Generating…" : "Download report"}
            </button>
            <button
              onClick={() => setView({ kind: "idle" })}
              className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border border-border text-text-muted hover:text-foreground hover:border-gray-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {view.kind === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 dark:border-red-500/30 dark:bg-red-500/5 p-5 space-y-2">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={14} />
            <span className="text-sm font-semibold">Audit failed</span>
          </div>
          <p className="text-xs text-text-muted">{view.message}</p>
          <button
            onClick={() => setView({ kind: "idle" })}
            className="text-xs text-text-muted hover:text-foreground transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Export info when no data yet */}
      {!hasSomeData && view.kind === "idle" && (
        <p className="text-xs text-text-muted">
          Run the audit first — then you can download a full report as a
          Markdown file you can open in Notion, Google Docs, or Word.
        </p>
      )}
    </div>
  );
}
