"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateTopicalMap } from "@/lib/actions/topical-map";
import type { KeywordClustering } from "@/lib/ai/cluster-keywords";

export function TopicalMapClient({
  tenantSlug,
  trackedKeywords,
}: {
  tenantSlug: string;
  trackedKeywords: string[];
}) {
  const [clustering, setClustering] = useState<KeywordClustering | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await generateTopicalMap(tenantSlug);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setClustering(res.clustering);
    });
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <p className="text-foreground font-semibold text-lg">Topical map</p>
          <p className="text-text-muted text-xs mt-0.5 max-w-[560px]">
            AI clusters your {trackedKeywords.length} tracked keyword
            {trackedKeywords.length !== 1 ? "s" : ""} into topic groups and
            suggests articles for each cluster. Re-run after you add keywords.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={isPending}>
          <Sparkles size={14} />
          {isPending ? "Clustering..." : clustering ? "Regenerate" : "Generate map"}
        </Button>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!clustering && !isPending && (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <Sparkles size={24} className="mx-auto text-text-muted mb-3" />
          <p className="text-foreground font-semibold mb-1">
            No topical map yet
          </p>
          <p className="text-text-muted text-sm">
            Tap &quot;Generate map&quot; — AI will group your tracked keywords
            into topic clusters + propose articles to cover each. ~$0.01 per
            run.
          </p>
        </div>
      )}

      {clustering && (
        <div className="space-y-4">
          <p className="text-xs text-text-muted">
            Showing {clustering.clusters.length} cluster
            {clustering.clusters.length !== 1 ? "s" : ""} across{" "}
            {trackedKeywords.length} keyword
            {trackedKeywords.length !== 1 ? "s" : ""}.
          </p>
          {clustering.clusters.map((c) => (
            <div
              key={c.name}
              className="bg-card rounded-2xl border border-border p-5"
            >
              <h3 className="text-foreground font-semibold mb-1">{c.name}</h3>
              <p className="text-sm text-text-secondary mb-4">
                {c.intent_summary}
              </p>

              <div className="mb-4">
                <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                  Keywords ({c.keywords.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {c.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-xs px-2 py-0.5 rounded-full bg-primary-50 border border-primary-500/20 text-primary-500"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                  Suggested articles
                </h4>
                <ul className="space-y-1.5">
                  {c.suggested_articles.map((a, i) => (
                    <li
                      key={i}
                      className="text-sm text-foreground flex items-start gap-2"
                    >
                      <span className="text-primary-500 mt-0.5 font-medium">
                        {i + 1}.
                      </span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
