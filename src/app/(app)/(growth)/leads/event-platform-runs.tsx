"use client";

// Event Discovery: run history for the event/ticketing-platform scraper,
// unifying the existing Apify-based platforms (Jetron, Eventbrite, Luma,
// Tix.africa — untouched, just now visible here for the first time) and the
// new self-hosted ones (Shows.ng, eGotickets, ...) in one list. Each run is
// a row; expand it to see the prospects it produced; "Run now" triggers a
// fresh run on demand instead of waiting for the nightly cron.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, RefreshCw, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/format";
import {
  runEventPlatformScraperNow,
  getEventScraperRunProspects,
} from "@/lib/actions/event-scraper";
import {
  EVENT_PLATFORM_LABELS,
  type EventScraperRunRecord,
} from "@/lib/types/event-scraper";
import type { ProspectRecord } from "@/lib/types/outbound";

export interface EventScraperPlatformOption {
  id: string;
  label: string;
  kind: "active" | "unconfirmed";
}

function platformLabel(id: string): string {
  return EVENT_PLATFORM_LABELS[id] ?? id;
}

const STATUS_TONE: Record<EventScraperRunRecord["status"], string> = {
  running: "bg-status-yellow/10 text-status-yellow",
  succeeded: "bg-status-green/10 text-status-green",
  partial: "bg-status-yellow/10 text-status-yellow",
  failed: "bg-status-red/10 text-status-red",
};

export function EventPlatformRuns({
  tenantSlug,
  initialRuns,
  platforms,
}: {
  tenantSlug: string;
  initialRuns: EventScraperRunRecord[];
  platforms: EventScraperPlatformOption[];
}) {
  const router = useRouter();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runProspects, setRunProspects] = useState<
    Record<string, ProspectRecord[]>
  >({});
  const [loadingProspects, setLoadingProspects] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (platforms.length === 0 && initialRuns.length === 0) return null;

  const handleRunNow = (platformId: string) => {
    setRunningId(platformId);
    setMessage(null);
    startTransition(async () => {
      const res = await runEventPlatformScraperNow(tenantSlug, platformId);
      setRunningId(null);
      if (!res.success) {
        setMessage({ tone: "error", text: `${platformLabel(platformId)} — ${res.error}` });
        return;
      }
      setMessage({
        tone: "success",
        text:
          res.prospectsCreated > 0
            ? `${platformLabel(platformId)} — found ${res.candidatesFound} priced events, added/updated ${res.prospectsCreated} prospect${res.prospectsCreated === 1 ? "" : "s"}`
            : `${platformLabel(platformId)} — ran successfully, no new priced events found`,
      });
      router.refresh();
    });
  };

  const toggleExpand = async (run: EventScraperRunRecord) => {
    if (expandedRunId === run.id) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(run.id);
    if (!runProspects[run.id]) {
      setLoadingProspects(run.id);
      const prospects = await getEventScraperRunProspects(tenantSlug, run.id);
      setRunProspects((prev) => ({ ...prev, [run.id]: prospects }));
      setLoadingProspects(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center shrink-0">
            <Radar size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              Event platform scrapers
            </h3>
            <p className="text-xs text-text-muted leading-relaxed">
              Daily crawl of ticketing platforms for organizers running paid
              events — feeds this pipeline the same way as a saved search.
              Each run below is one platform, one crawl.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.tone === "success"
              ? "border-status-green/30 bg-status-green/5 text-status-green"
              : "border-status-red/30 bg-status-red/5 text-status-red"
          }`}
          role="status"
        >
          {message.text}
        </div>
      )}

      {platforms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {platforms.map((p) => {
            const busy = runningId === p.id;
            return (
              <Button
                key={p.id}
                size="sm"
                variant="ghost"
                onClick={() => handleRunNow(p.id)}
                disabled={busy}
                className="gap-1.5"
                title={
                  p.kind === "unconfirmed"
                    ? "Best-effort parser — not yet confirmed to have a scrapable listing page"
                    : undefined
                }
              >
                {busy ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                Run {p.label}
                {p.kind === "unconfirmed" && (
                  <span className="text-[10px] text-text-muted">(best-effort)</span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {initialRuns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-xs text-text-muted">
            No runs yet — the nightly cron hasn&rsquo;t fired, or click a
            &ldquo;Run&rdquo; button above to trigger one now.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {initialRuns.map((run) => {
            const expanded = expandedRunId === run.id;
            const prospects = runProspects[run.id];
            return (
              <li key={run.id} className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggleExpand(run)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronRight
                      size={13}
                      className={`shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {platformLabel(run.platform)}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_TONE[run.status]}`}
                    >
                      {run.status}
                    </span>
                    <span className="text-[10px] text-text-muted shrink-0">
                      {run.provider === "apify" ? "Apify" : "self-hosted"}
                    </span>
                    {run.trigger === "manual" && (
                      <span className="text-[10px] text-text-muted shrink-0">
                        manual
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-text-muted">
                    <span>{run.prospectsCreated} prospects</span>
                    <span>{formatDateTime(run.startedAt)}</span>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-border px-3 py-2.5">
                    {loadingProspects === run.id && (
                      <p className="text-xs text-text-muted flex items-center gap-1.5">
                        <Loader2 size={11} className="animate-spin" /> Loading…
                      </p>
                    )}
                    {prospects && prospects.length === 0 && (
                      <p className="text-xs text-text-muted">
                        No prospects linked to this run.
                      </p>
                    )}
                    {prospects && prospects.length > 0 && (
                      <ul className="space-y-1">
                        {prospects.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-2 text-xs py-1"
                          >
                            <span className="text-foreground truncate">
                              {p.displayName ?? p.handle}
                              {p.eventTitle && (
                                <span className="text-text-muted"> · {p.eventTitle}</span>
                              )}
                            </span>
                            <span className="text-text-muted shrink-0">{p.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {run.error && (
                      <p className="text-xs text-status-red mt-1">
                        {(run.error.message as string) ?? "Run failed"}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
