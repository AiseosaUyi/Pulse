"use client";

// Dashboard banner for the weekly business review. Shows the latest
// narrative inline, with a CTA to (re)generate and to expand wins /
// drags / next-week focus.

import { useState, useTransition } from "react";
import { formatDate } from "@/lib/utils/format";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateWeeklyReview } from "@/lib/actions/weekly-reviews";
import type { WeeklyReview } from "@/lib/ai/weekly-review";
import type { WeeklyReviewRecord } from "@/lib/services/weekly-reviews";

const CONFIDENCE_TONE: Record<
  WeeklyReview["confidence"],
  { label: string; cls: string }
> = {
  high: { label: "High confidence", cls: "bg-status-green/10 text-status-green" },
  medium: {
    label: "Medium confidence",
    cls: "bg-status-yellow/10 text-status-yellow",
  },
  low: { label: "Low confidence", cls: "bg-sidebar text-text-muted" },
};

export function WeeklyReviewBanner({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: WeeklyReviewRecord | null;
}) {
  const [latest, setLatest] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenerate] = useTransition();

  const handleGenerate = () => {
    setError(null);
    startGenerate(async () => {
      const res = await generateWeeklyReview(tenantSlug);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setLatest({
        id: "pending",
        tenantSlug,
        weekOf: res.weekOf,
        narrative: res.review.narrative,
        review: res.review,
        generatedAt: new Date().toISOString(),
        emailSentAt: null,
      });
      setExpanded(true);
    });
  };

  if (!latest) {
    return (
      <section className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-foreground font-semibold text-sm">
                Weekly business review
              </h2>
              <p className="text-[11px] text-text-muted mt-0.5">
                Get a one-paragraph synthesis of everything Pulse shipped
                this week plus a focus for next week.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="gap-1.5"
          >
            {isGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Generate this week
          </Button>
        </div>
        {error && (
          <p className="mt-3 text-xs text-status-red" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const review = latest.review;

  return (
    <section className="bg-card border border-border rounded-2xl p-5">
      <header className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-foreground font-semibold text-sm">
              Weekly business review
            </h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              Week of {formatDate(latest.weekOf)}
              {" · generated "}
              {formatDate(latest.generatedAt)}
              {review?.confidence && (
                <span
                  className={`ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    CONFIDENCE_TONE[review.confidence].cls
                  }`}
                >
                  {CONFIDENCE_TONE[review.confidence].label}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="gap-1.5"
          >
            {isGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Re-run
          </Button>
        </div>
      </header>

      {latest.narrative && (
        <p className="text-sm text-foreground leading-relaxed">
          {latest.narrative}
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-status-red" role="alert">
          {error}
        </p>
      )}

      {review && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600"
          >
            {expanded ? (
              <>
                <ChevronUp size={12} />
                Hide breakdown
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                Show wins, drags & next week
              </>
            )}
          </button>

          {expanded && (
            <div className="grid md:grid-cols-3 gap-3 mt-3">
              <BreakdownCard
                icon={<CheckCircle2 size={12} className="text-status-green" />}
                title="Wins"
                items={review.wins}
                emptyText="Nothing worth celebrating yet."
              />
              <BreakdownCard
                icon={<AlertTriangle size={12} className="text-status-red" />}
                title="Drags"
                items={review.drags}
                emptyText="No obvious drags this week."
              />
              <div className="rounded-lg border border-primary-500/20 bg-primary-500/5 p-3">
                <h3 className="text-[10px] uppercase tracking-wide text-primary-500 font-semibold mb-2 flex items-center gap-1">
                  <ArrowRight size={12} />
                  Next week focus
                </h3>
                <ul className="space-y-2">
                  {review.next_week_focus.map((f, i) => (
                    <li key={i}>
                      <p className="text-xs font-semibold text-foreground">
                        {f.title}
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                        {f.why}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BreakdownCard({
  icon,
  title,
  items,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2 flex items-center gap-1">
        {icon}
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-[11px] text-text-muted italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-foreground leading-relaxed">
              • {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
