"use client";

import { type IntelCard as IntelCardType } from "@/lib/types/intelligence";
import { Badge } from "@/components/ui/Badge";
import { useState, useTransition } from "react";
import { generateBriefFromCard } from "@/lib/actions/briefs";

interface IntelCardProps {
  card: IntelCardType;
  tenantSlug: string;
}

const platformColors: Record<string, string> = {
  instagram: "text-pink-400",
  tiktok: "text-cyan-400",
  twitter: "text-blue-400",
  linkedin: "text-blue-300",
  blog: "text-green-400",
};

const impactBadge: Record<string, "high_impact" | "urgent" | "opportunity"> = {
  high: "high_impact",
  medium: "opportunity",
  low: "active" as "opportunity",
};

const urgencyBadge: Record<string, "urgent" | "opportunity" | "active"> = {
  urgent: "urgent",
  opportunity: "opportunity",
  fyi: "active",
};

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function IntelCard({ card, tenantSlug }: IntelCardProps) {
  const [isPending, startTransition] = useTransition();
  const [briefGenerated, setBriefGenerated] = useState(false);

  const handleStealThis = () => {
    startTransition(async () => {
      const result = await generateBriefFromCard(card.id, tenantSlug);
      if (result.success) {
        setBriefGenerated(true);
      } else {
        alert(result.error);
      }
    });
  };

  const initials = card.competitorName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="bg-card rounded-xl border border-border/50 p-5 hover:border-border transition-colors duration-150">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-border/50 flex items-center justify-center text-sm font-bold text-foreground/70">
            {initials}
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {card.competitorName}
            </div>
            <div className="text-xs text-text-muted">
              <span className={platformColors[card.platform] ?? "text-text-muted"}>
                {card.platform.charAt(0).toUpperCase() + card.platform.slice(1)}
              </span>
              {" · "}
              {card.contentType.charAt(0).toUpperCase() + card.contentType.slice(1)}
              {card.competitorType !== "direct" && (
                <span className="text-text-muted/60">
                  {" · "}
                  {card.competitorType === "aspirational"
                    ? "Non-direct competitor"
                    : "Adjacent"}
                </span>
              )}
            </div>
          </div>
        </div>
        <span className="text-xs text-text-muted">{timeAgo(card.detectedAt)}</span>
      </div>

      {/* Summary */}
      <div className="bg-sidebar rounded-lg p-3.5 mb-3.5 text-[13px] leading-relaxed text-foreground/80 border-l-2 border-border">
        {card.summary}
      </div>

      {/* Metrics */}
      <div className="flex gap-5 mb-3.5">
        {card.metrics.views != null && (
          <div>
            <div className="text-base font-bold text-foreground">
              {formatNumber(card.metrics.views)}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-text-muted">
              Views
            </div>
          </div>
        )}
        <div>
          <div className="text-base font-bold text-foreground">
            {card.metrics.engagementRate}%
          </div>
          <div className="text-[11px] uppercase tracking-wide text-text-muted">
            Engagement
          </div>
        </div>
        {card.metrics.shares != null && (
          <div>
            <div className="text-base font-bold text-foreground">
              {formatNumber(card.metrics.shares)}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-text-muted">
              Shares
            </div>
          </div>
        )}
        {card.metrics.vsAverage != null && (
          <div>
            <div className="text-base font-bold text-status-green">
              {card.metrics.vsAverage}x
            </div>
            <div className="text-[11px] uppercase tracking-wide text-text-muted">
              vs. avg
            </div>
          </div>
        )}
      </div>

      {/* AI Recommendation */}
      {card.aiRecommendation && (
        <div className="rounded-lg border border-primary-500/20 bg-primary-500/[0.07] p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-primary-500 text-sm">✦</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-primary-500">
              Pulse Intelligence
            </span>
            <Badge variant={urgencyBadge[card.aiRecommendation.urgency]}>
              {card.aiRecommendation.urgency === "fyi"
                ? "FYI"
                : card.aiRecommendation.urgency.charAt(0).toUpperCase() +
                  card.aiRecommendation.urgency.slice(1)}
            </Badge>
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/80 mb-2">
            {card.aiRecommendation.analysis}
          </p>
          <p className="text-[13px] leading-relaxed text-foreground/90 font-medium">
            {card.aiRecommendation.action}
          </p>
          {card.aiRecommendation.contentBriefReady && (
            <div className="mt-3">
              <button
                onClick={handleStealThis}
                disabled={isPending || briefGenerated}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium border border-primary-500/30 bg-primary-500/15 text-primary-500 hover:bg-primary-500/25 transition-colors disabled:opacity-50"
              >
                {isPending
                  ? "Generating..."
                  : briefGenerated
                    ? "Brief Generated ✓"
                    : "Steal This →"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
