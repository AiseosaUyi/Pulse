"use client";

// The 60-second brand audit wizard. One URL in → populated brand voice
// + positioning out → straight into a dashboard that's full of real
// data. Everything the user used to fill out by hand.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Globe, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runBrandAudit } from "@/lib/actions/brand-audit";

interface Props {
  tenantSlug: string;
  tenantName: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running"; started: number }
  | { kind: "done"; summary: string; pages: string[] }
  | { kind: "error"; message: string };

// The phase labels are a local UX animation — the audit is a single
// server call, so we fake a progress log on the client to make the
// ~20s wait feel like deliberate work. Each phase advances on a timer
// and stops at the last one until the server returns.
const PHASES = [
  { at: 0, label: "Reaching your site…" },
  { at: 3500, label: "Reading your homepage…" },
  { at: 8000, label: "Listening for your voice…" },
  { at: 13000, label: "Mapping your positioning…" },
  { at: 18000, label: "Polishing your profile…" },
];

export function AuditWizardClient({ tenantSlug, tenantName }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [elapsedMs, setElapsedMs] = useState(0);

  // While running, update elapsed every 500ms so the progress log
  // stays in sync without pulling `Date.now()` inside child render.
  // When the phase leaves "running" the component re-renders without
  // the RunningPanel, so we don't need to reset elapsedMs here.
  const startedAt = phase.kind === "running" ? phase.started : null;
  useEffect(() => {
    if (startedAt == null) return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => clearInterval(id);
  }, [startedAt]);

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPhase({ kind: "running", started: Date.now() });
    startTransition(async () => {
      try {
        const res = await runBrandAudit(tenantSlug, trimmed);
        if (res.success) {
          setPhase({
            kind: "done",
            summary: res.summary,
            pages: res.pagesFetched,
          });
        } else {
          setPhase({ kind: "error", message: res.error });
        }
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Audit failed.",
        });
      }
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
          Paste your website URL and we&apos;ll build your brand profile,
          find your competitors, and queue your first month of content —
          in under a minute.
        </p>
      </div>

      {phase.kind === "idle" || phase.kind === "error" ? (
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
                  if (e.key === "Enter" && !isPending) submit();
                }}
                disabled={isPending}
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {phase.kind === "error" && (
            <div className="rounded-lg border border-status-red/30 bg-status-red/10 p-3 flex items-start gap-2">
              <AlertTriangle
                size={14}
                className="text-status-red mt-0.5 shrink-0"
              />
              <p className="text-xs text-status-red">{phase.message}</p>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={enterApp}
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Skip for now
            </button>
            <Button
              onClick={submit}
              disabled={!url.trim() || isPending}
              size="default"
            >
              <Sparkles size={14} />
              Build my brand profile
            </Button>
          </div>
        </div>
      ) : phase.kind === "running" ? (
        <RunningPanel elapsedMs={elapsedMs} />
      ) : (
        <DonePanel summary={phase.summary} pages={phase.pages} onEnter={enterApp} />
      )}

      <p className="text-[11px] text-center text-text-muted">
        Nothing is published. We only read what&apos;s already public on
        your site.
      </p>
    </div>
  );
}

function RunningPanel({ elapsedMs }: { elapsedMs: number }) {
  const elapsed = elapsedMs;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-6 md:p-8 space-y-5">
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
            This usually takes 15-25 seconds.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {PHASES.map((p, i) => {
          const reached = elapsed >= p.at;
          const isCurrent =
            reached &&
            (i === PHASES.length - 1 || elapsed < PHASES[i + 1].at);
          return (
            <li
              key={p.label}
              className="flex items-center gap-2.5 text-sm transition-colors"
            >
              <span
                className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-bold ${
                  isCurrent
                    ? "bg-primary-500 text-white animate-pulse"
                    : reached
                      ? "bg-status-green text-white"
                      : "bg-sidebar text-text-muted"
                }`}
              >
                {reached && !isCurrent ? "✓" : ""}
              </span>
              <span
                className={
                  reached ? "text-foreground" : "text-text-muted"
                }
              >
                {p.label}
              </span>
            </li>
          );
        })}
      </ul>

    </div>
  );
}

function DonePanel({
  summary,
  pages,
  onEnter,
}: {
  summary: string;
  pages: string[];
  onEnter: () => void;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-6 md:p-8 space-y-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-status-green/15 text-status-green">
          ✓
        </span>
        <p className="text-base font-semibold text-foreground">
          Brand profile built.
        </p>
      </div>

      <blockquote className="border-l-2 border-primary-500 pl-4 py-1 text-foreground text-[15px] leading-relaxed">
        {summary}
      </blockquote>

      <div className="text-xs text-text-muted space-y-1">
        <p>Sources we read:</p>
        <ul className="ml-4 list-disc space-y-0.5">
          {pages.map((p) => (
            <li key={p} className="break-all">
              {p}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-text-secondary">
        Voice and positioning are saved to your workspace. You can refine
        them anytime in <span className="font-medium">Settings</span>.
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
