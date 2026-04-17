"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrendCard } from "@/components/trends/TrendCard";
import { AddTrendModal } from "@/components/trends/AddTrendModal";
import type { TrendScout } from "@/lib/types/trends";

type Filter = "all" | "tiktok" | "instagram" | "twitter";

export function ViralTrendsClient({
  trends,
  tenantSlug,
}: {
  trends: TrendScout[];
  tenantSlug: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    return trends.filter((t) => {
      if (t.dismissedAt !== null && !showDismissed) return false;
      if (filter !== "all" && t.platform !== filter) return false;
      return true;
    });
  }, [trends, filter, showDismissed]);

  const dismissedCount = trends.filter((t) => t.dismissedAt !== null).length;

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-1 p-0.5 bg-sidebar rounded-full border border-border/50">
          {(["all", "tiktok", "instagram", "twitter"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-card text-foreground shadow-sm"
                  : "text-text-muted hover:text-foreground"
              }`}
            >
              {f === "twitter" ? "Twitter/X" : f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
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
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add trend
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <h3 className="text-foreground font-semibold mb-1">
            {trends.length === 0 ? "No trends tracked yet" : "Nothing here"}
          </h3>
          <p className="text-text-muted text-sm">
            {trends.length === 0
              ? "Spot a viral post? Tap 'Add trend' to paste the details and get AI analysis."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((t) => (
            <TrendCard key={t.id} trend={t} tenantSlug={tenantSlug} />
          ))}
        </div>
      )}

      {adding && (
        <AddTrendModal tenantSlug={tenantSlug} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
