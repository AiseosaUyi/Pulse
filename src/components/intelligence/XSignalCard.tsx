"use client";

import Link from "next/link";
import { Heart, Repeat2, MessageCircle, X } from "lucide-react";
import { useState } from "react";
import { dismissXSignal } from "@/lib/actions/x-intel";
import type { XSignalCard as XSignalCardType } from "@/lib/types/x-intel";

interface Props {
  card: XSignalCardType;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

const SOURCE_LABELS: Record<XSignalCardType["signalType"], string> = {
  keyword: "keyword match",
  account_monitor: "account post",
  trending: "trending",
};

const SOURCE_CLASSES: Record<XSignalCardType["signalType"], string> = {
  keyword: "bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400",
  account_monitor: "bg-white-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
  trending: "bg-warning-50 text-warning-500 dark:bg-warning-500/15 dark:text-warning-500",
};

export function XSignalCard({ card }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const replyAngle = encodeURIComponent(
    `Reply to @${card.authorHandle}: ${card.tweetText.slice(0, 200)}`
  );
  const useAngle = encodeURIComponent(card.tweetText.slice(0, 300));

  const sourceLabel =
    card.signalType === "keyword" && card.matchedKeyword
      ? `keyword · ${card.matchedKeyword}`
      : card.signalType === "account_monitor" && card.accountHandle
      ? `account · @${card.accountHandle}`
      : SOURCE_LABELS[card.signalType];

  const handleDismiss = async () => {
    setDismissed(true);
    await dismissXSignal(card.id);
  };

  if (dismissed) return null;

  return (
    <div className="bg-card rounded-xl border border-border/50 p-5 hover:border-border transition-colors duration-150">
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center text-[11px] font-medium rounded-full px-2.5 py-0.5 ${SOURCE_CLASSES[card.signalType]}`}
          >
            {sourceLabel}
          </span>
          <span className="text-[11px] text-text-muted">
            @{card.authorHandle}
            {card.authorFollowers != null && card.authorFollowers > 0 && (
              <span className="ml-1 text-text-muted/60">
                · {formatNum(card.authorFollowers)} followers
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-text-muted">{timeAgo(card.postedAt)}</span>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="text-text-muted/50 hover:text-text-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tweet text */}
      <div className="bg-white-600 dark:bg-sidebar rounded-lg px-4 py-3.5 mb-3.5 text-[13px] leading-relaxed text-gray-1200 dark:text-foreground/80 whitespace-pre-wrap">
        {card.tweetText}
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-5 mb-4">
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <Heart size={13} className="text-text-muted/70" />
          <span className="font-semibold text-foreground">{formatNum(card.likes)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <Repeat2 size={13} className="text-text-muted/70" />
          <span className="font-semibold text-foreground">{formatNum(card.reposts)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <MessageCircle size={13} className="text-text-muted/70" />
          <span className="font-semibold text-foreground">{formatNum(card.replies)}</span>
        </span>
        <a
          href={card.tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-text-muted hover:text-foreground transition-colors"
        >
          View on X →
        </a>
      </div>

      {/* CTAs */}
      <div className="flex items-center gap-2">
        <Link
          href={`/composer?angle=${replyAngle}`}
          className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border border-primary-500 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
        >
          Reply →
        </Link>
        <Link
          href={`/composer?angle=${useAngle}`}
          className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
        >
          Use this angle →
        </Link>
      </div>
    </div>
  );
}
