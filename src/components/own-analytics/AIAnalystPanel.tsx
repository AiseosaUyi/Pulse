"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateAnalyticsReport } from "@/lib/actions/analytics-import";
import type { OwnPostMetric } from "@/lib/types/own-metrics";
import type { ImportablePost } from "@/lib/actions/analytics-import";

interface Report {
  narrative: string;
  recommendations: Array<{ title: string; body: string }>;
  generated_at: string;
}

interface Props {
  tenantSlug: string;
  platform: string;
  posts: OwnPostMetric[];
  initialReport: Report | null;
}

export function AIAnalystPanel({ tenantSlug, platform, posts, initialReport }: Props) {
  const [report, setReport] = useState<Report | null>(initialReport);
  const [open, setOpen] = useState(true);
  const [isPending, startT] = useTransition();

  const regenerate = () => {
    const importable: ImportablePost[] = posts.map((p) => ({
      capturedAt: p.capturedAt,
      platform: p.platform,
      caption: p.caption ?? p.title,
      externalUrl: p.externalUrl,
      metrics: p.metrics as ImportablePost["metrics"],
    }));

    startT(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await generateAnalyticsReport(tenantSlug, platform as any, importable);
      // Reload the report by refreshing page data
      window.location.reload();
    });
  };

  return (
    <div className="bg-card border border-primary-500/20 rounded-2xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-primary-500/5 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-primary-500" />
          <span className="text-sm font-semibold text-foreground">AI Analyst</span>
          {report && (
            <span className="text-[10px] text-text-muted ml-1">
              · {new Date(report.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); regenerate(); }}
            disabled={isPending || !posts.length}
            className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-primary-500 disabled:opacity-40"
          >
            {isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {isPending ? "Analysing…" : "Refresh"}
          </button>
          {open ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="px-5 pb-5 border-t border-border/30">
          {!report && !isPending && (
            <div className="pt-4 text-center">
              <p className="text-sm text-text-muted mb-3">
                {posts.length > 0
                  ? "No report yet — generate one to get trends, insights, and recommendations."
                  : "Import your data first, then run the analysis."}
              </p>
              {posts.length > 0 && (
                <Button size="sm" onClick={regenerate} disabled={isPending} className="gap-1.5">
                  <Sparkles size={13} /> Analyse {posts.length} posts
                </Button>
              )}
            </div>
          )}

          {isPending && (
            <div className="pt-4 flex items-center gap-2 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin text-primary-500" />
              Analysing your data…
            </div>
          )}

          {report && !isPending && (
            <div className="pt-4 space-y-5">
              {/* Narrative */}
              <div className="prose prose-sm max-w-none text-sm text-foreground leading-relaxed">
                {report.narrative.split("\n\n").map((para, i) => (
                  <p key={i} className="mb-3 last:mb-0">{para}</p>
                ))}
              </div>

              {/* Recommendations */}
              {report.recommendations.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Recommendations</p>
                  <div className="space-y-2">
                    {report.recommendations.map((r, i) => (
                      <div key={i} className="flex gap-3 p-3 rounded-xl bg-sidebar/50 border border-border/40">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-primary-500/10 text-primary-500 text-[11px] font-bold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-[12px] font-semibold text-foreground">{r.title}</p>
                          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{r.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
