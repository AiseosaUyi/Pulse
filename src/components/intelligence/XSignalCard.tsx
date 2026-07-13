"use client";

import Link from "next/link";
import { Heart, Repeat2, MessageCircle, X, Sparkles, Copy, Check } from "lucide-react";
import { useState, useTransition } from "react";
import { dismissXSignal, suggestXEngagement } from "@/lib/actions/x-intel";
import type { XSignalCard as XSignalCardType } from "@/lib/types/x-intel";
import type { XEngagementSuggestion } from "@/lib/ai/x-engage";
import { truncateSafe } from "@/lib/utils";

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

const SOURCE_CLASSES: Record<XSignalCardType["signalType"], string> = {
  keyword: "bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400",
  account_monitor: "bg-white-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
  trending: "bg-warning-50 text-warning-500 dark:bg-warning-500/15 dark:text-warning-500",
};

const ACTION_LABELS: Record<XEngagementSuggestion["action"], { label: string; color: string }> = {
  both: { label: "Do both", color: "text-success-600 dark:text-success-400" },
  reply: { label: "Reply only", color: "text-primary-600 dark:text-primary-400" },
  quote: { label: "Quote tweet", color: "text-blue-600 dark:text-blue-400" },
  skip: { label: "Skip this one", color: "text-text-muted" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="text-text-muted/60 hover:text-text-muted transition-colors shrink-0"
      title="Copy to clipboard"
    >
      {copied ? <Check size={12} className="text-success-500" /> : <Copy size={12} />}
    </button>
  );
}

export function XSignalCard({ card }: Props) {
  const [dismissed, setDismissed] = useState(false);
  // Initialise from DB cache so already-generated suggestions render immediately
  const [suggestion, setSuggestion] = useState<XEngagementSuggestion | null>(
    card.aiAction
      ? {
          reply: card.aiReply ?? "",
          quoteTweet: card.aiQuoteTweet ?? "",
          action: card.aiAction,
          reasoning: card.aiReasoning ?? "",
          opportunityScore: card.aiScore ?? 5,
        }
      : null
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sourceLabel =
    card.signalType === "keyword" && card.matchedKeyword
      ? `keyword · ${card.matchedKeyword}`
      : card.signalType === "account_monitor" && card.accountHandle
      ? `account · @${card.accountHandle}`
      : card.signalType === "trending"
      ? "trending"
      : "keyword match";

  const handleDismiss = async () => {
    setDismissed(true);
    await dismissXSignal(card.id);
  };

  const handleSuggest = () => {
    setError(null);
    startTransition(async () => {
      const result = await suggestXEngagement(card.id, card.tenantSlug);
      if (result.success) {
        setSuggestion(result.data);
      } else {
        setError(result.error);
      }
    });
  };

  const replyAngle = encodeURIComponent(
    suggestion?.reply
      ? suggestion.reply
      : `Reply to @${card.authorHandle}: ${truncateSafe(card.tweetText, 200)}`
  );
  const quoteAngle = encodeURIComponent(
    suggestion?.quoteTweet ?? truncateSafe(card.tweetText, 300)
  );

  if (dismissed) return null;

  const scoreColor =
    suggestion && suggestion.opportunityScore >= 8
      ? "text-success-600 dark:text-success-400"
      : suggestion && suggestion.opportunityScore >= 5
      ? "text-warning-500"
      : "text-text-muted";

  return (
    <div className="bg-card rounded-xl border border-border/50 p-5 hover:border-border transition-colors duration-150">
      {/* Header */}
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
          {suggestion && (
            <span className={`text-[11px] font-semibold ${scoreColor}`}>
              {suggestion.opportunityScore}/10
            </span>
          )}
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
      <div className="bg-white-600 dark:bg-sidebar rounded-lg px-4 py-3.5 mb-3.5 text-[13px] leading-relaxed text-gray-1200 dark:text-foreground/80 whitespace-pre-wrap line-clamp-5">
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

      {/* AI Suggestions */}
      {suggestion ? (
        <div className="mb-4 rounded-xl border border-border bg-white-600 dark:bg-sidebar/60 overflow-hidden">
          {/* Recommendation strip */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-primary-50/50 dark:bg-primary-500/5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
              <Sparkles size={11} className="text-primary-500" />
              Pulse recommends
            </span>
            <span className={`text-xs font-semibold ${ACTION_LABELS[suggestion.action].color}`}>
              {ACTION_LABELS[suggestion.action].label}
            </span>
          </div>

          {/* Reasoning */}
          <p className="px-4 pt-3 pb-2 text-[12px] text-text-muted italic leading-relaxed">
            {suggestion.reasoning}
          </p>

          {/* Reply suggestion */}
          {suggestion.action !== "skip" && (suggestion.action === "reply" || suggestion.action === "both") && (
            <div className="px-4 pt-1 pb-3 border-b border-border/40">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Reply</span>
                <CopyButton text={suggestion.reply} />
              </div>
              <p className="text-[13px] leading-relaxed text-foreground">{suggestion.reply}</p>
            </div>
          )}

          {/* Quote tweet suggestion */}
          {suggestion.action !== "skip" && (suggestion.action === "quote" || suggestion.action === "both") && (
            <div className="px-4 pt-2 pb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Quote tweet</span>
                <CopyButton text={suggestion.quoteTweet} />
              </div>
              <p className="text-[13px] leading-relaxed text-foreground">{suggestion.quoteTweet}</p>
            </div>
          )}
        </div>
      ) : null}

      {error && (
        <p className="mb-3 text-xs text-red-500">{error}</p>
      )}

      {/* CTAs */}
      <div className="flex items-center gap-2 flex-wrap">
        {!suggestion && (
          <button
            onClick={handleSuggest}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
          >
            <Sparkles size={11} />
            {isPending ? "Generating…" : "Suggest reply & quote"}
          </button>
        )}

        {(suggestion?.action === "reply" || suggestion?.action === "both") && (
          <Link
            href={`/composer?angle=${replyAngle}`}
            className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border border-primary-500 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
          >
            Post reply →
          </Link>
        )}

        {(suggestion?.action === "quote" || suggestion?.action === "both") && (
          <Link
            href={`/composer?angle=${quoteAngle}`}
            className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
          >
            Post quote tweet →
          </Link>
        )}

        {suggestion?.action === "skip" && (
          <span className="text-xs text-text-muted italic">Skipping — low opportunity for this brand</span>
        )}

        {!suggestion && (
          <>
            <Link
              href={`/composer?angle=${encodeURIComponent(`Reply to @${card.authorHandle}: ${truncateSafe(card.tweetText, 200)}`)}`}
              className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border border-border text-text-muted hover:text-foreground hover:border-gray-400 transition-colors"
            >
              Reply →
            </Link>
            <Link
              href={`/composer?angle=${encodeURIComponent(truncateSafe(card.tweetText, 300))}`}
              className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border border-border text-text-muted hover:text-foreground hover:border-gray-400 transition-colors"
            >
              Use angle →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
