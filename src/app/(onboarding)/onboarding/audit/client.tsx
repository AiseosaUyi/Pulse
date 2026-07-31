"use client";

// The 60-second brand audit wizard. One URL in → populated brand voice,
// positioning, competitors, keywords, and 5 starter content briefs
// out → straight into a dashboard that's full of real data.
//
// The server side runs as a 4-phase state machine (brand-audit.ts):
// voice → competitors → keywords → briefs. The client polls
// advanceFullAudit() between phases so the ~60s total can fit inside
// multiple <25s function invocations under Vercel Hobby's 60s cap.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Globe, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  startFullAudit,
  advanceFullAudit,
  cancelFullAudit,
  skipBrandAudit,
  type AuditPhase,
  type AuditState,
} from "@/lib/actions/brand-audit";

interface Props {
  tenantSlug: string;
  tenantName: string;
}

type ViewPhase =
  | { kind: "idle" }
  | { kind: "running"; live: AuditState | null }
  | { kind: "done"; state: AuditState }
  | { kind: "error"; message: string };

/**
 * Display labels for each server-side phase — shown in the live
 * progress log during the run.
 */
const PHASE_STEPS: Array<{
  key: AuditPhase | "starting";
  label: string;
  detail: string;
}> = [
  {
    key: "starting",
    label: "Reading your site",
    detail: "Fetching your homepage and key pages",
  },
  {
    key: "voice_done",
    label: "Extracting your voice",
    detail: "Finding how you sound and what you stand for",
  },
  {
    key: "competitors_done",
    label: "Identifying competitors",
    detail: "Naming 3-5 brands you benchmark against",
  },
  {
    key: "keywords_done",
    label: "Discovering keywords",
    detail: "15-25 SEO queries to track",
  },
  {
    key: "ok",
    label: "Drafting your first briefs",
    detail: "5 content ideas to kick off your first month",
  },
];

/**
 * Given the state.phase the server is currently IN, compute which UI
 * step is actively running. When the server reports phase=voice_done
 * it means voice is finished and competitors is next up — so the
 * active step is index 1 (Identifying competitors).
 */
function activeStepIndex(phase: AuditPhase): number {
  switch (phase) {
    case "starting":
      return 0; // Reading site
    case "voice_done":
      return 1; // Competitors running
    case "competitors_done":
      return 2; // Keywords running
    case "keywords_done":
      return 3; // Briefs running
    case "ok":
      return PHASE_STEPS.length; // all done
    case "failed":
      return -1;
  }
}

// Cap polling to avoid runaway loops if a phase returns without
// advancing (shouldn't happen — belts and suspenders).
const MAX_POLL_STEPS = 8;

export function AuditWizardClient({ tenantSlug, tenantName }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [view, setView] = useState<ViewPhase>({ kind: "idle" });
  const [, startTransition] = useTransition();
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

    // Poll advance until terminal or cap reached.
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
        setView({
          kind: "error",
          message: current.error ?? "Audit failed. Please try again.",
        });
        return;
      }
    }

    setView({
      kind: "error",
      message:
        "Reached the step cap without finishing. Try cancelling and running again.",
    });
  };

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setView({ kind: "running", live: null });
    startTransition(async () => {
      try {
        await runLoop(trimmed);
      } catch (err) {
        setView({
          kind: "error",
          message: err instanceof Error ? err.message : "Audit failed.",
        });
      }
    });
  };

  const cancel = () => {
    abortRef.current = true;
  };

  const [skipping, startSkipping] = useTransition();

  const handleSkip = () => {
    startSkipping(async () => {
      const res = await skipBrandAudit(tenantSlug);
      if (!res.success) {
        setView({ kind: "error", message: res.error });
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  };

  const enterApp = () => {
    router.push("/dashboard");
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary-500 font-semibold mb-3">
          <Sparkles size={13} />
          <span>Your AI marketing team</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground leading-tight">
          Welcome to Pulse, {tenantName}.
        </h1>
        <p className="mt-3 text-text-secondary text-base md:text-lg max-w-lg mx-auto">
          Paste your website URL. In about a minute we&apos;ll build your
          brand profile, find your competitors, surface your SEO
          keywords, and draft your first 5 content briefs.
        </p>
      </div>

      {view.kind === "idle" || view.kind === "error" ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-5 md:p-6 space-y-4">
          <div>
            <label
              htmlFor="audit-url"
              className="text-sm font-medium text-foreground"
            >
              Your website
            </label>
            <p className="text-xs text-text-muted mt-0.5">
              Homepage is enough. We&apos;ll find the rest.
            </p>
            <div className="mt-2.5 relative">
              <Globe
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <Input
                id="audit-url"
                type="text"
                placeholder="gruve.events"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isRunning) submit();
                }}
                disabled={isRunning}
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {view.kind === "error" && (
            <div className="rounded-lg border border-status-red/30 bg-status-red/10 p-3 flex items-start gap-2">
              <AlertTriangle
                size={14}
                className="text-status-red mt-0.5 shrink-0"
              />
              <p className="text-xs text-status-red">{view.message}</p>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={handleSkip}
              disabled={skipping || isRunning}
              className="text-xs text-text-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              {skipping ? "Skipping…" : "Skip for now"}
            </button>
            <Button
              onClick={submit}
              disabled={!url.trim() || isRunning}
              size="default"
            >
              <Sparkles size={14} />
              Build my brand profile
            </Button>
          </div>
        </div>
      ) : view.kind === "running" ? (
        <RunningPanel live={view.live} onCancel={cancel} />
      ) : (
        <DonePanel state={view.state} onEnter={enterApp} />
      )}

      <p className="text-[11px] text-center text-text-muted">
        Nothing is published. We only read what&apos;s already public on
        your site.
      </p>
    </div>
  );
}

function RunningPanel({
  live,
  onCancel,
}: {
  live: AuditState | null;
  onCancel: () => void;
}) {
  const phase: AuditPhase = live?.phase ?? "starting";
  const active = activeStepIndex(phase);

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-6 md:p-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Your team is on it.
            </p>
            <p className="text-xs text-text-muted">
              This usually finishes in under a minute.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

      <ul className="space-y-2.5">
        {PHASE_STEPS.map((step, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li
              key={step.key}
              className="flex items-start gap-2.5 text-sm transition-colors"
            >
              <span
                className={`mt-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-bold shrink-0 ${
                  current
                    ? "bg-primary-500 text-white animate-pulse"
                    : done
                      ? "bg-status-green text-white"
                      : "bg-sidebar text-text-muted border border-border"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              <div className="min-w-0">
                <p
                  className={`leading-tight ${
                    done || current ? "text-foreground" : "text-text-muted"
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {live && (
        <div className="rounded-lg border border-border/50 bg-sidebar/40 p-3 text-[11px] text-text-muted grid grid-cols-3 gap-2">
          <Stat label="Competitors" value={live.competitors_added} />
          <Stat label="Keywords" value={live.keywords_added} />
          <Stat label="Briefs" value={live.briefs_added} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
        {label}
      </p>
      <p className="text-foreground font-semibold text-sm mt-0.5">
        {value > 0 ? value : "—"}
      </p>
    </div>
  );
}

function DonePanel({
  state,
  onEnter,
}: {
  state: AuditState;
  onEnter: () => void;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-6 md:p-8 space-y-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-status-green/15 text-status-green">
          ✓
        </span>
        <p className="text-base font-semibold text-foreground">
          Your marketing team is ready.
        </p>
      </div>

      {state.summary && (
        <blockquote className="border-l-2 border-primary-500 pl-4 py-1 text-foreground text-[15px] leading-relaxed">
          {state.summary}
        </blockquote>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Voice" value="Saved" success />
        <Card
          label="Competitors"
          value={state.competitors_added}
        />
        <Card label="Keywords" value={state.keywords_added} />
        <Card label="Starter briefs" value={state.briefs_added} />
      </div>

      <p className="text-xs text-text-secondary">
        Every section in the app is now seeded. You can refine anything
        in Settings, Competition, SEO tracker, or Content briefs.
      </p>

      <div className="flex justify-end">
        <Button onClick={onEnter} size="default">
          Open my dashboard
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  success,
}: {
  label: string;
  value: string | number;
  success?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-sidebar/40 p-3 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
        {label}
      </p>
      <p
        className={`font-semibold text-sm mt-1 ${
          success ? "text-status-green" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
