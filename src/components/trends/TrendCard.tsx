"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { dismissTrend, restoreTrend } from "@/lib/actions/trends";
import type { TrendScout, TrendApplicability } from "@/lib/types/trends";

function applicabilityBadge(
  app: TrendApplicability | null
): { variant: "high_impact" | "opportunity" | "low_activity" | "gap"; label: string } {
  switch (app) {
    case "high":
      return { variant: "high_impact", label: "High fit" };
    case "medium":
      return { variant: "opportunity", label: "Medium fit" };
    case "low":
      return { variant: "low_activity", label: "Low fit" };
    case "n/a":
    default:
      return { variant: "gap", label: "Not analyzed" };
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TrendCard({
  trend,
  tenantSlug,
}: {
  trend: TrendScout;
  tenantSlug: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const app = applicabilityBadge(trend.applicability);

  const handleDismiss = () => {
    const reason = window.prompt(
      "Why dismissing? (Optional — helps tune what we show next time)"
    );
    if (reason === null) return;
    startTransition(async () => {
      const res = await dismissTrend(trend.id, tenantSlug, reason || undefined);
      if (!res.success) alert(res.error);
    });
  };

  const handleRestore = () => {
    startTransition(async () => {
      const res = await restoreTrend(trend.id, tenantSlug);
      if (!res.success) alert(res.error);
    });
  };

  const isDismissed = trend.dismissedAt !== null;

  return (
    <div
      className={`bg-card rounded-2xl border border-border overflow-hidden ${
        isDismissed ? "opacity-50" : ""
      }`}
    >
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              {trend.platform}
            </span>
            <span className="text-text-muted">·</span>
            <span className="text-xs uppercase tracking-wide text-text-muted">
              {trend.source.replace("_", " ")}
            </span>
            {trend.hashtag && (
              <span className="text-xs font-mono text-primary-500">
                {trend.hashtag.startsWith("#") ? trend.hashtag : `#${trend.hashtag}`}
              </span>
            )}
            <Badge variant={app.variant}>{app.label}</Badge>
          </div>

          {trend.title && (
            <h3 className="text-foreground font-semibold mb-1">{trend.title}</h3>
          )}

          <p className="text-sm text-text-secondary leading-relaxed">
            {trend.summary}
          </p>

          {/* Metrics */}
          {(trend.metrics.views || trend.metrics.engagement_rate) && (
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              {trend.metrics.views !== undefined && (
                <span>
                  <span className="text-foreground font-medium">
                    {formatNumber(trend.metrics.views)}
                  </span>{" "}
                  views
                </span>
              )}
              {trend.metrics.engagement_rate !== undefined && (
                <span>
                  ER{" "}
                  <span className="text-foreground font-medium">
                    {trend.metrics.engagement_rate}%
                  </span>
                </span>
              )}
              {trend.externalUrl && (
                <a
                  href={trend.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-500 hover:underline"
                >
                  View post →
                </a>
              )}
            </div>
          )}

          {trend.aiAnalysis && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-3 text-xs text-primary-500 hover:underline"
            >
              Show AI analysis
            </button>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          {isDismissed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestore}
              disabled={isPending}
            >
              Restore
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              disabled={isPending}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {expanded && trend.aiAnalysis && (
        <div className="px-5 pb-5 pt-0 border-t border-border/30 space-y-3 bg-sidebar">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1 pt-4">
              Why it&apos;s working
            </h4>
            <p className="text-sm text-foreground/90">
              {trend.aiAnalysis.why_viral}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Format
            </h4>
            <p className="text-sm text-foreground/90">
              {trend.aiAnalysis.format}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Adapt for us
            </h4>
            <p className="text-sm text-foreground/90">
              {trend.aiAnalysis.suggested_adaptation}
            </p>
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-primary-500 hover:underline"
          >
            Hide
          </button>
        </div>
      )}
    </div>
  );
}
