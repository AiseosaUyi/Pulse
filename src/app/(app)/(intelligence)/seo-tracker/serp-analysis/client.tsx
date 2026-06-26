"use client";

import { useState, useTransition } from "react";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { useRouter } from "next/navigation";
import {
  Search,
  Trash2,
  ExternalLink,
  PenLine,
  Wrench,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  analyzeSerpForKeyword,
  deleteSerpAnalysis,
  createDraftFromSerp,
  createEditRecFromSerp,
} from "@/lib/actions/serp";
import { useDialogs } from "@/components/ui/Dialog";
import type { SerpAnalysisRecord } from "@/lib/types/serp";

export function SerpAnalysisClient({
  analyses,
  tenantSlug,
  trackedKeywords,
}: {
  analyses: SerpAnalysisRecord[];
  tenantSlug: string;
  trackedKeywords: string[];
}) {
  const dialogs = useDialogs();
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("ng");
  const [isPending, startTransition] = useTransition();
  const [actionPending, startAction] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(analyses[0]?.id ?? null);

  const handleAnalyze = () => {
    if (!keyword.trim()) {
      setError("Keyword required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await analyzeSerpForKeyword(tenantSlug, {
        keyword: keyword.trim(),
        region,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOpenId(res.analysisId);
      setKeyword("");
    });
  };

  const handleDelete = async (id: string) => {
    const ok = await dialogs.confirm({
      title: "Delete this SERP analysis?",
      subtitle:
        "The snapshot and its top-10 results are removed. You can re-run the analysis anytime.",
      tone: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteSerpAnalysis(id, tenantSlug);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't delete analysis",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  const handleCreateDraft = (analysisId: string) => {
    startAction(async () => {
      const res = await createDraftFromSerp(tenantSlug, analysisId);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't create draft",
          subtitle: res.error,
          tone: "destructive",
        });
        return;
      }
      router.push(`/seo-tracker/blog-writer/${res.postId}`);
    });
  };

  const handleCreateEdits = (analysisId: string) => {
    startAction(async () => {
      const res = await createEditRecFromSerp(tenantSlug, analysisId);
      if (!res.success) {
        await dialogs.alert({
          title: "No page to optimize",
          subtitle: res.error,
        });
        return;
      }
      await dialogs.alert({
        title: "Optimization recommendation created",
        subtitle:
          "Added to the review queue with the SERP gap as edit guidance. The team can review and re-publish — the 30-day impact is captured on apply.",
      });
    });
  };

  const open = analyses.find((a) => a.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="text-foreground font-semibold text-sm mb-1">
          Analyze a keyword
        </h3>
        <p className="text-text-muted text-xs mb-4">
          Scrapes Google&apos;s top 10 results, then AI explains what&apos;s
          working and where the gap is for you. ~$0.01 per keyword.
        </p>

        {trackedKeywords.length > 0 && (
          <div className="mb-3">
            <Label>Quick pick from tracked keywords</Label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {trackedKeywords.slice(0, 10).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKeyword(k)}
                  className="text-xs px-2.5 py-1 rounded-full bg-sidebar border border-border text-text-muted hover:border-primary-500/40 transition-colors"
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-[1fr_120px_auto] gap-3 items-end">
          <div>
            <Label htmlFor="sa-keyword">Keyword</Label>
            <Input
              id="sa-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. event ticketing Lagos"
              disabled={isPending}
            />
          </div>
          <div>
            <Label htmlFor="sa-region">Country</Label>
            <Input
              id="sa-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="ng"
              maxLength={3}
              disabled={isPending}
              className="font-mono uppercase"
            />
          </div>
          <Button onClick={handleAnalyze} disabled={isPending}>
            <Search size={14} />
            {isPending ? "Analyzing..." : "Analyze SERP"}
          </Button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>

      {analyses.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <p className="text-foreground font-semibold mb-1">
            No SERP analyses yet
          </p>
          <p className="text-text-muted text-sm">
            Pick a keyword above and tap Analyze. Results are cached and
            re-running overwrites the old analysis for the same keyword.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-[280px_1fr] gap-4">
          {/* Sidebar list */}
          <aside className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-3 border-b border-border/30">
              <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold">
                Saved analyses
              </h4>
            </div>
            <ul className="divide-y divide-border/30 max-h-[60vh] overflow-y-auto">
              {analyses.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setOpenId(a.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-sidebar transition-colors ${
                      a.id === openId ? "bg-sidebar" : ""
                    }`}
                  >
                    <p className="text-sm text-foreground truncate">
                      {a.keyword}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {(a.region ?? "").toUpperCase() || "—"} ·{" "}
                      {a.topResults.length} results ·{" "}
                      {formatDate(a.updatedAt, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Detail view */}
          {open && (
            <main className="space-y-4">
              <div className="bg-card rounded-2xl border border-border p-5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-foreground font-semibold">
                    {open.keyword}
                  </h3>
                  <p className="text-text-muted text-xs mt-1">
                    {(open.region ?? "").toUpperCase()} · Analyzed{" "}
                    {formatDateTime(open.updatedAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(open.id)}
                  className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  aria-label="Delete analysis"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Turn analysis into action: a new draft, or edits on the page
                  that already targets this keyword. */}
              <div className="bg-card rounded-2xl border border-border p-4 flex flex-wrap items-center gap-3">
                <p className="text-xs text-text-muted flex-1 min-w-[180px]">
                  Act on this gap — write a new post targeting the keyword, or
                  queue optimization edits for the page that already ranks for
                  it.
                </p>
                <Button
                  onClick={() => handleCreateDraft(open.id)}
                  disabled={actionPending}
                >
                  {actionPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <PenLine size={14} />
                  )}
                  Create draft from gap
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleCreateEdits(open.id)}
                  disabled={actionPending}
                >
                  {actionPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Wrench size={14} />
                  )}
                  Generate optimization edits
                </Button>
              </div>

              {open.aiAnalysis && (
                <>
                  <section className="bg-card rounded-2xl border border-border p-5">
                    <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                      Gap for us
                    </h4>
                    <p className="text-foreground">{open.aiAnalysis.gap_for_us}</p>
                  </section>

                  <section className="bg-card rounded-2xl border border-border p-5">
                    <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                      Our angle
                    </h4>
                    <p className="text-foreground text-sm leading-relaxed">
                      {open.aiAnalysis.our_angle}
                    </p>
                  </section>

                  <section className="bg-card rounded-2xl border border-border p-5">
                    <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                      How to compete
                    </h4>
                    <p className="text-foreground text-sm leading-relaxed">
                      {open.aiAnalysis.how_to_compete}
                    </p>
                  </section>

                  <div className="grid md:grid-cols-2 gap-4">
                    <section className="bg-card rounded-2xl border border-border p-5">
                      <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                        Common themes
                      </h4>
                      <ul className="space-y-1.5 text-sm">
                        {open.aiAnalysis.common_themes.map((t, i) => (
                          <li
                            key={i}
                            className="text-foreground flex items-start gap-2"
                          >
                            <span className="text-primary-500 mt-0.5">•</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section className="bg-card rounded-2xl border border-border p-5">
                      <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
                        Format hint
                      </h4>
                      <p className="text-foreground text-sm">
                        {open.aiAnalysis.content_length_hint}
                      </p>
                      {open.aiAnalysis.serp_features.length > 0 && (
                        <>
                          <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mt-4 mb-2">
                            SERP features
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {open.aiAnalysis.serp_features.map((f, i) => (
                              <span
                                key={i}
                                className="text-xs px-2 py-0.5 rounded-full bg-sidebar border border-border text-text-muted"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </section>
                  </div>
                </>
              )}

              <section className="bg-card rounded-2xl border border-border overflow-hidden">
                <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold px-5 py-3 border-b border-border/30">
                  Top {open.topResults.length} results
                </h4>
                <ol className="divide-y divide-border/30">
                  {open.topResults.map((r) => (
                    <li key={r.position} className="p-4 flex items-start gap-3">
                      <span className="text-sm font-mono text-text-muted w-6 shrink-0">
                        #{r.position}
                      </span>
                      <div className="flex-1 min-w-0">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground font-medium hover:text-primary-500 truncate flex items-center gap-1"
                        >
                          {r.title}
                          <ExternalLink size={12} className="shrink-0" />
                        </a>
                        <p className="text-xs text-text-muted mt-0.5">
                          {r.domain}
                        </p>
                        {r.snippet && (
                          <p className="text-xs text-text-secondary mt-1.5 line-clamp-2">
                            {r.snippet}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </main>
          )}
        </div>
      )}
    </div>
  );
}
