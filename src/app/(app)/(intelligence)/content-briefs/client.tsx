"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BriefCard } from "@/components/briefs/BriefCard";
import type { ContentBrief, ContentBriefStatus } from "@/lib/types/intelligence";

type Filter = "all" | "draft" | "approved" | "published";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
];

interface Props {
  briefs: ContentBrief[];
  tenantSlug: string;
  hasVoice: boolean;
}

export function ContentBriefsClient({ briefs, tenantSlug, hasVoice }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showDismissed, setShowDismissed] = useState(false);

  const filtered = useMemo(() => {
    return briefs.filter((b) => {
      if (b.status === "dismissed") return showDismissed;
      if (filter === "all") return true;
      return b.status === (filter as ContentBriefStatus);
    });
  }, [briefs, filter, showDismissed]);

  const dismissedCount = briefs.filter((b) => b.status === "dismissed").length;

  return (
    <>
      {!hasVoice && (
        <div className="rounded-2xl border-2 border-dashed border-border p-6 md:p-8 mb-6 text-center">
          <h3 className="text-foreground font-semibold mb-1">
            Add your brand voice to unlock briefs
          </h3>
          <p className="text-text-muted text-sm mb-4 max-w-md mx-auto">
            Without a brand voice, the generator falls back to generic output.
            Takes about 30 minutes to set up, one-time.
          </p>
          <Link
            href="/settings/brand-voice"
            className="inline-flex items-center px-4 py-2 bg-primary-500 text-white rounded-full text-sm font-medium hover:bg-primary-600 transition-colors"
          >
            Set brand voice
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-1 p-0.5 bg-sidebar rounded-full border border-border/50">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {dismissedCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary-500"
            />
            Show dismissed ({dismissedCount})
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <h3 className="text-foreground font-semibold mb-1">
            {filter === "all" && !showDismissed
              ? "No briefs yet"
              : `No ${filter === "all" ? "" : filter + " "}briefs`}
          </h3>
          <p className="text-text-muted text-sm">
            {filter === "all" && briefs.length === 0 ? (
              <>
                Head to the{" "}
                <Link href="/intel-feed" className="text-primary-500 hover:underline">
                  Intel Feed
                </Link>{" "}
                and tap &quot;Generate&quot; on a competitor post.
              </>
            ) : (
              <>Try a different filter.</>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((brief) => (
            <BriefCard key={brief.id} brief={brief} tenantSlug={tenantSlug} />
          ))}
        </div>
      )}
    </>
  );
}
