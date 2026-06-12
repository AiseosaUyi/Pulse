"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, Loader2, PenLine, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateTopicalMap,
  generateDraftFromArticle,
  type SavedTopicalMap,
  type TopicalDraftMap,
} from "@/lib/actions/topical-map";
import type { KeywordClustering } from "@/lib/ai/cluster-keywords";

function draftKey(clusterName: string, articleTitle: string): string {
  return `${clusterName}::${articleTitle}`;
}

export function TopicalMapClient({
  tenantSlug,
  trackedKeywords,
  savedMap,
}: {
  tenantSlug: string;
  trackedKeywords: string[];
  savedMap: SavedTopicalMap | null;
}) {
  const [clustering, setClustering] = useState<KeywordClustering | null>(
    savedMap?.clustering ?? null
  );
  const [drafts, setDrafts] = useState<TopicalDraftMap>(
    savedMap?.drafts ?? {}
  );
  const [generatedAt, setGeneratedAt] = useState<string | null>(
    savedMap?.generatedAt ?? null
  );
  const [isPending, startTransition] = useTransition();
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
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
      setGeneratedAt(new Date().toISOString());
      setDrafts({}); // a fresh map invalidates prior article→draft links
    });
  };

  const handleGenerateDraft = (
    clusterName: string,
    articleTitle: string,
    primaryKeyword: string
  ) => {
    const key = draftKey(clusterName, articleTitle);
    setError(null);
    setDraftingKey(key);
    startTransition(async () => {
      const res = await generateDraftFromArticle(tenantSlug, {
        clusterName,
        articleTitle,
        primaryKeyword,
      });
      setDraftingKey(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setDrafts((prev) => ({ ...prev, [key]: res.postId }));
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
            suggests articles for each cluster. Click an article to spin up a
            draft. Hit Regenerate after you add keywords to rebuild the map.
          </p>
          {generatedAt && (
            <p className="text-text-muted/70 text-xs mt-1">
              Last generated{" "}
              {new Date(generatedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              .
            </p>
          )}
        </div>
        <Button onClick={handleGenerate} disabled={isPending}>
          {isPending && !draftingKey ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {isPending && !draftingKey
            ? "Clustering..."
            : clustering
              ? "Regenerate"
              : "Generate map"}
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
          {clustering.clusters.map((c) => {
            // Representative keyword to target when drafting from this cluster.
            const clusterKeyword = c.keywords[0] ?? c.name;
            return (
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
                    {c.suggested_articles.map((a, i) => {
                      const key = draftKey(c.name, a);
                      const draftedPostId = drafts[key];
                      const isDrafting = draftingKey === key;
                      return (
                        <li
                          key={i}
                          className="text-sm text-foreground flex items-start justify-between gap-3 group"
                        >
                          <span className="flex items-start gap-2">
                            <span className="text-primary-500 mt-0.5 font-medium">
                              {i + 1}.
                            </span>
                            <span>{a}</span>
                          </span>
                          {draftedPostId ? (
                            <Link
                              href={`/seo-tracker/blog-writer/${draftedPostId}`}
                              className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary-500 hover:underline"
                            >
                              Open draft
                              <ArrowUpRight size={12} />
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleGenerateDraft(c.name, a, clusterKeyword)
                              }
                              disabled={isPending}
                              className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary-500 disabled:opacity-50"
                            >
                              {isDrafting ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  Drafting...
                                </>
                              ) : (
                                <>
                                  <PenLine size={12} />
                                  Generate draft
                                </>
                              )}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
