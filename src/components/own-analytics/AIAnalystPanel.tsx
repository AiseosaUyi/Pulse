"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, RefreshCw, Zap, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateAnalyticsReport } from "@/lib/actions/analytics-import";
import type { OwnPostMetric } from "@/lib/types/own-metrics";
import type { ImportablePost } from "@/lib/actions/analytics-import";

interface GrowthAction {
  title: string;
  impact: string;
  timeframe: string;
  body: string;
}

interface FrequencyVerdict {
  current: string;
  recommended: string;
  gap: string;
}

interface Projections {
  conservative: string;
  withViralMoment: string;
  keyMultiplier: string;
  viralPotential: string;
}

interface ContentInsight {
  type: string;
  count: number;
  verdict: string;
}

interface Report {
  narrative: string;
  recommendations: Array<{ title: string; body: string }>;
  generated_at: string;
  raw_metrics?: {
    growthActions?: GrowthAction[];
    frequencyVerdict?: FrequencyVerdict;
    projections?: Projections;
    missingData?: string[];
    contentInsights?: ContentInsight[];
  } | null;
}

interface Props {
  tenantSlug: string;
  platform: string;
  posts: OwnPostMetric[];
  initialReport: Report | null;
}

const IMPACT_STYLES: Record<string, string> = {
  Critical: "bg-red-500/10 text-red-500 border-red-500/20",
  High: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Medium: "bg-primary-500/10 text-primary-500 border-primary-500/20",
};

export function AIAnalystPanel({ tenantSlug, platform, posts, initialReport }: Props) {
  const [report, setReport] = useState<Report | null>(initialReport);
  const [open, setOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<"overview" | "growth" | "frequency" | "missing">("overview");
  const [isPending, startT] = useTransition();

  const growthActions = report?.raw_metrics?.growthActions ?? [];
  const frequencyVerdict = report?.raw_metrics?.frequencyVerdict ?? null;
  const projections = report?.raw_metrics?.projections ?? null;
  const missingData = report?.raw_metrics?.missingData ?? [];
  const contentInsights = report?.raw_metrics?.contentInsights ?? [];
  const hasExtended = growthActions.length > 0 || !!frequencyVerdict || missingData.length > 0;

  // setReport is used after regenerate once the page reloads — kept for future use
  void setReport;

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

      {open && (
        <div className="border-t border-border/30">
          {/* Empty / loading state */}
          {!report && !isPending && (
            <div className="px-5 py-6 text-center">
              <p className="text-sm text-text-muted mb-3">
                {posts.length > 0
                  ? "No report yet — generate one to get a growth plan, frequency verdict, and what's missing from your data."
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
            <div className="px-5 py-6 flex items-center gap-2 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin text-primary-500" />
              Analysing your data…
            </div>
          )}

          {report && !isPending && (
            <>
              {/* Section tabs — only show if extended data exists */}
              {hasExtended && (
                <div className="flex items-center gap-0 border-b border-border/30 px-5 overflow-x-auto">
                  {(["overview", "growth", "frequency", "missing"] as const).map((s) => {
                    const labels: Record<string, string> = {
                      overview: "Overview",
                      growth: `Growth Plan${growthActions.length ? ` (${growthActions.length})` : ""}`,
                      frequency: "Frequency",
                      missing: `What We Need${missingData.length ? ` (${missingData.length})` : ""}`,
                    };
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setActiveSection(s)}
                        className={`shrink-0 text-[11px] font-medium px-3 py-2.5 border-b-2 transition-colors ${
                          activeSection === s
                            ? "border-primary-500 text-primary-500"
                            : "border-transparent text-text-muted hover:text-foreground"
                        }`}
                      >
                        {labels[s]}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Overview — narrative + projections + recommendations + content insights */}
              {(activeSection === "overview" || !hasExtended) && (
                <div className="px-5 py-5 space-y-5">
                  <div className="prose prose-sm max-w-none text-sm text-foreground leading-relaxed">
                    {report.narrative.split("\n\n").map((para, i) => (
                      <p key={i} className="mb-3 last:mb-0">{para}</p>
                    ))}
                  </div>

                  {/* Projections */}
                  {projections && (
                    <div>
                      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">12-month outlook</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                        <div className="p-3 rounded-xl bg-sidebar/50 border border-border/40">
                          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Cadence only</p>
                          <p className="text-[12px] font-semibold text-foreground">{projections.conservative}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-primary-500/5 border border-primary-500/20">
                          <p className="text-[10px] font-semibold text-primary-500 uppercase tracking-wider mb-1">With a breakout Reel</p>
                          <p className="text-[12px] font-semibold text-foreground">{projections.withViralMoment}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-sidebar/50 border border-border/40">
                        <Zap size={12} className="text-primary-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[11px] font-semibold text-foreground mb-0.5">The multiplier</p>
                          <p className="text-[11px] text-text-muted leading-relaxed">{projections.keyMultiplier}</p>
                        </div>
                        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ml-auto ${
                          projections.viralPotential?.toLowerCase().startsWith("high")
                            ? "bg-green-500/10 text-green-600 border-green-500/20"
                            : projections.viralPotential?.toLowerCase().startsWith("medium")
                            ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
                            : "bg-sidebar text-text-muted border-border/40"
                        }`}>
                          {projections.viralPotential?.split(" ")[0]} virality
                        </span>
                      </div>
                    </div>
                  )}

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

                  {contentInsights.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">By content type</p>
                      <div className="space-y-2">
                        {contentInsights.map((c, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-sidebar/50 border border-border/40">
                            <span className="shrink-0 w-28 text-[10px] font-semibold text-text-muted uppercase bg-border/30 px-1.5 py-0.5 rounded mt-0.5 leading-tight">{c.type}</span>
                            <div className="min-w-0">
                              <p className="text-[11px] text-foreground leading-relaxed">{c.verdict}</p>
                              <p className="text-[10px] text-text-muted mt-0.5">{c.count} posts</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Growth Plan */}
              {activeSection === "growth" && hasExtended && (
                <div className="px-5 py-5">
                  <p className="text-xs text-text-muted mb-4 leading-relaxed">
                    Specific plays to grow followers and visibility 10x. Ranked by impact.
                  </p>
                  <div className="space-y-3">
                    {growthActions.map((a, i) => (
                      <div key={i} className="p-4 rounded-xl bg-sidebar/50 border border-border/40">
                        <div className="flex items-start gap-3 mb-2">
                          <p className="text-[12px] font-semibold text-foreground leading-snug flex-1">{a.title}</p>
                          <div className="shrink-0 w-16 flex justify-end">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${IMPACT_STYLES[a.impact] ?? IMPACT_STYLES.Medium}`}>
                              {a.impact}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] text-text-muted leading-relaxed">{a.body}</p>
                        <div className="flex items-center gap-1 mt-2">
                          <Clock size={10} className="text-text-muted/60" />
                          <span className="text-[10px] text-text-muted/60">{a.timeframe}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Frequency */}
              {activeSection === "frequency" && hasExtended && frequencyVerdict && (
                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-sidebar/50 border border-border/40">
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Current pace</p>
                      <p className="text-sm font-semibold text-foreground">{frequencyVerdict.current}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-primary-500/5 border border-primary-500/20">
                      <p className="text-[10px] font-semibold text-primary-500 uppercase tracking-wider mb-1.5">Recommended</p>
                      <p className="text-sm font-semibold text-foreground">{frequencyVerdict.recommended}</p>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-sidebar/50 border border-border/40">
                    <div className="flex items-start gap-2">
                      <Zap size={13} className="text-primary-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[11px] font-semibold text-foreground mb-1">The gap</p>
                        <p className="text-[11px] text-text-muted leading-relaxed">{frequencyVerdict.gap}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* What We Need */}
              {activeSection === "missing" && hasExtended && (
                <div className="px-5 py-5">
                  <p className="text-xs text-text-muted mb-4 leading-relaxed">
                    The AI analyst needs this data to give you a sharper, more accurate growth plan. Share what you can.
                  </p>
                  <div className="space-y-2">
                    {missingData.map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-sidebar/50 border border-border/40">
                        <AlertCircle size={12} className="text-primary-500/60 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-foreground leading-relaxed">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
