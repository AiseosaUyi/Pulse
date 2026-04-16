import type { WeeklyDigest as WeeklyDigestType } from "@/lib/types/intelligence";

interface WeeklyDigestProps {
  digest: WeeklyDigestType | null;
  tenantName: string;
  briefCount: number;
}

export function WeeklyDigest({ digest, tenantName, briefCount }: WeeklyDigestProps) {
  if (!digest) {
    return (
      <div className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.05em] text-text-muted mb-4">
          Weekly Digest
        </h2>
        <div className="bg-card rounded-lg border border-border/50 p-4 text-center">
          <p className="text-sm text-text-muted">
            Not enough data for a digest yet. Add more competitor activity to unlock weekly insights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.05em] text-text-muted">
        Weekly Digest — {tenantName}
      </h2>

      {/* Winning Formats */}
      {digest.winningFormats.length > 0 && (
        <div className="bg-card rounded-lg border border-border/50 p-3.5">
          <h3 className="text-[13px] font-semibold text-foreground mb-2">
            Content Formats Winning
          </h3>
          {digest.winningFormats.map((fmt) => (
            <div key={fmt.format} className="mb-2 last:mb-0">
              <p className="text-xs text-foreground/80">{fmt.format}</p>
              <p className="text-[11px] text-text-muted">{fmt.evidence}</p>
              {fmt.multiplier > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="flex-1 h-1 bg-border rounded-full">
                    <div
                      className="h-1 rounded-full bg-gradient-to-r from-accent-purple to-accent-pink"
                      style={{ width: `${Math.min(fmt.multiplier * 20, 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-text-muted whitespace-nowrap">
                    {fmt.multiplier}x avg
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recommended Actions */}
      <div className="bg-card rounded-lg border border-border/50 p-3.5">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">
          Recommended Actions
        </h3>
        <ol className="space-y-1.5">
          {digest.recommendedActions.map((action) => (
            <li key={action.priority} className="flex gap-2">
              <span className="text-xs font-bold text-accent-purple shrink-0">
                {action.priority}.
              </span>
              <span className="text-xs text-foreground/80">
                {action.action}
                {action.deadline && (
                  <span className="text-status-red ml-1">
                    (by {action.deadline})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Strategic Brief */}
      <div className="bg-card rounded-lg border border-border/50 p-3.5">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">
          Strategic Brief
        </h3>
        <p className="text-xs leading-relaxed text-text-secondary">
          {digest.strategicBrief}
        </p>
      </div>

      {/* Content Pipeline */}
      {briefCount > 0 && (
        <div className="pt-3 border-t border-border/30">
          <h2 className="text-sm font-semibold uppercase tracking-[0.05em] text-text-muted mb-3">
            Content Pipeline
          </h2>
          <div className="bg-card rounded-lg border border-border/50 p-3.5">
            <h3 className="text-[13px] font-semibold text-accent-purple">
              {briefCount} Brief{briefCount !== 1 ? "s" : ""} Ready
            </h3>
            <a
              href="/content-briefs"
              className="mt-2 inline-block px-3 py-1.5 rounded-md text-xs font-medium border border-accent-purple/30 bg-accent-purple/[0.15] text-purple-300 hover:bg-accent-purple/25 transition-colors"
            >
              View All Briefs →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
