// Per-sub-score breakdown with progress bars + issue list. Lives inside
// the BlogSidePanel. Matches the visual language of the rubric doc:
//   90+ = teal, 80+ = green, 70+ = amber, <70 = red.
// Issues are sorted by severity (high → med → low) by the orchestrator,
// so we can render them in the order we receive them.

import type { BlogScoreIssue, BlogSubScores } from "@/lib/types/blog-posts";

function toneForPct(pct: number) {
  if (pct >= 0.9) return "bg-status-teal text-status-teal";
  if (pct >= 0.8) return "bg-status-green text-status-green";
  if (pct >= 0.7) return "bg-status-yellow text-status-yellow";
  return "bg-status-red text-status-red";
}

const SUBSCORE_LABEL: Record<keyof BlogSubScores, string> = {
  alignment: "Brand alignment",
  seo: "SEO fundamentals",
  readability: "Readability",
  depth: "Depth & originality",
  structure: "Structure",
  faq: "FAQ schema",
  eeat: "E-E-A-T",
};

const SEV_TONE = {
  high: "bg-status-red/10 text-status-red border-status-red/30",
  med: "bg-status-yellow/10 text-status-yellow border-status-yellow/30",
  low: "bg-sidebar text-text-muted border-border",
} as const;

export function ScoreBreakdown({
  total,
  subScores,
  issues,
  warning,
}: {
  total: number | null;
  subScores: BlogSubScores | null;
  issues: BlogScoreIssue[];
  warning: boolean;
}) {
  if (total == null || !subScores) {
    return (
      <div className="rounded-xl border border-dashed border-border p-5 text-sm text-text-muted">
        Not scored yet. Rerun generation or hit Rescore (Phase D) to compute.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with big number */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">
            Content score
          </p>
          <p className="text-3xl font-bold text-foreground mt-0.5">
            {total}
            <span className="text-lg text-text-muted font-normal"> / 100</span>
          </p>
        </div>
        {warning ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-status-yellow/10 border border-status-yellow/30 text-status-yellow">
            Iteration budget exhausted
          </span>
        ) : total >= 80 ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-status-green/10 border border-status-green/30 text-status-green">
            Above publish bar
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-status-red/10 border border-status-red/30 text-status-red">
            Below 80 bar
          </span>
        )}
      </div>

      {/* Sub-scores */}
      <div className="space-y-2.5">
        {(Object.keys(subScores) as Array<keyof BlogSubScores>).map((key) => {
          const s = subScores[key];
          const pct = s.max > 0 ? s.score / s.max : 0;
          const [bgCls, textCls] = toneForPct(pct).split(" ");
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">{SUBSCORE_LABEL[key]}</span>
                <span className={`font-semibold ${textCls}`}>
                  {s.score} / {s.max}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-border/50 overflow-hidden">
                <div
                  className={`h-full rounded-full ${bgCls}`}
                  style={{ width: `${Math.max(pct * 100, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Issues list */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
          Improvement suggestions
        </p>
        {issues.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing flagged. Publishable as-is.
          </p>
        ) : (
          <ul className="space-y-2">
            {issues.map((issue, i) => (
              <li
                key={i}
                className={`rounded-lg border p-3 ${SEV_TONE[issue.severity]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide">
                    {SUBSCORE_LABEL[issue.subScore] ?? issue.subScore} · {issue.severity}
                  </p>
                </div>
                <p className="text-sm text-foreground mt-1">{issue.message}</p>
                {issue.suggestedFix && (
                  <p className="text-xs text-text-muted mt-1.5">
                    → {issue.suggestedFix}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
