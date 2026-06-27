"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Lightbulb, RefreshCw, Copy, Check, FileText, Film, BarChart2, Hash } from "lucide-react";
import { suggestXPostIdeas } from "@/lib/actions/x-intel";
import type { XPostIdea } from "@/lib/ai/x-engage";

const FORMAT_ICONS: Record<XPostIdea["format"], React.ReactNode> = {
  text: <FileText size={11} />,
  thread: <Hash size={11} />,
  media: <Film size={11} />,
  poll: <BarChart2 size={11} />,
};

const FORMAT_LABELS: Record<XPostIdea["format"], string> = {
  text: "Text tweet",
  thread: "Thread",
  media: "With media",
  poll: "Poll",
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
      className="p-1.5 rounded-lg text-text-muted/60 hover:text-text-muted hover:bg-white-200 dark:hover:bg-sidebar transition-colors"
      title="Copy tweet"
    >
      {copied ? <Check size={13} className="text-success-500" /> : <Copy size={13} />}
    </button>
  );
}

interface Props {
  tenantSlug: string;
  topSignalIds: string[];
}

export function XPostIdeasPanel({ tenantSlug, topSignalIds }: Props) {
  const [ideas, setIdeas] = useState<XPostIdea[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const result = await suggestXPostIdeas(tenantSlug, topSignalIds);
      if (result.success) {
        setIdeas(result.ideas);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 bg-primary-50/30 dark:bg-primary-500/5">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className="text-primary-500" />
          <span className="text-sm font-semibold text-foreground">Post ideas</span>
          <span className="text-[11px] text-text-muted">— inspired by what&apos;s working in your niche</span>
        </div>
        <button
          onClick={generate}
          disabled={isPending || topSignalIds.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={11} className={isPending ? "animate-spin" : ""} />
          {isPending ? "Generating…" : ideas ? "Refresh ideas" : "Generate ideas"}
        </button>
      </div>

      {error && (
        <p className="px-5 py-3 text-xs text-red-500">{error}</p>
      )}

      {!ideas && !isPending && !error && (
        <div className="px-5 py-6 text-center text-sm text-text-muted">
          Pulse studies what&apos;s performing in your niche and writes original posts you can tweet today.
        </div>
      )}

      {isPending && (
        <div className="px-5 py-6 text-center text-sm text-text-muted animate-pulse">
          Studying what&apos;s working in your niche…
        </div>
      )}

      {ideas && (
        <div className="divide-y divide-border/40">
          {ideas.map((idea, i) => (
            <div key={i} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {/* Format badge */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      {FORMAT_ICONS[idea.format]}
                      {FORMAT_LABELS[idea.format]}
                    </span>
                    <span className="text-[10px] text-text-muted/60">· inspired by {idea.inspiredBy}</span>
                  </div>

                  {/* Tweet text */}
                  <p className="text-[13px] leading-relaxed text-foreground mb-2 font-medium">
                    {idea.text}
                  </p>

                  {/* Why it works */}
                  <p className="text-[11px] text-text-muted italic">{idea.whyItWorks}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-1">
                  <CopyButton text={idea.text} />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <Link
                  href={`/composer?angle=${encodeURIComponent(idea.text)}`}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                >
                  Open in Composer →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
