import type { CrossBrandPattern } from "@/lib/services/cross-brand";

interface CrossBrandInsightsProps {
  patterns: CrossBrandPattern[];
}

export function CrossBrandInsights({ patterns }: CrossBrandInsightsProps) {
  if (patterns.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-accent-pink/20 bg-gradient-to-r from-accent-pink/[0.06] to-accent-purple/[0.04] p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent-pink text-sm">◆</span>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-accent-pink">
          Cross-Brand Insights
        </h2>
        <span className="text-[11px] text-text-muted">
          Patterns working across your portfolio
        </span>
      </div>
      <div className="space-y-3">
        {patterns.map((pattern) => (
          <div
            key={pattern.id}
            className="bg-card/50 rounded-lg p-3.5 border border-border/30"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-foreground">
                {pattern.pattern}
              </span>
              <span className="text-xs font-bold text-status-green">
                {pattern.avgMultiplier}x avg
              </span>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed mb-2">
              {pattern.recommendation}
            </p>
            <div className="flex gap-1.5">
              {pattern.tenants.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-full bg-accent-purple/10 border border-accent-purple/20 text-[11px] text-purple-300 capitalize"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
