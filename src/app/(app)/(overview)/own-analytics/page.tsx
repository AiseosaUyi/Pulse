import { cookies } from "next/headers";
import { TrendingUp } from "lucide-react";
import {
  listOwnMetrics,
  getOwnMetricsSummary,
} from "@/lib/services/own-metrics";
import { UploadPanel } from "@/components/own-analytics/UploadPanel";
import { MetricsTable } from "@/components/own-analytics/MetricsTable";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLATFORM_LABEL: Record<OwnMetricsPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
};

export default async function OwnAnalyticsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [summary, metrics] = await Promise.all([
    getOwnMetricsSummary(tenantSlug),
    listOwnMetrics(tenantSlug, { limit: 100 }),
  ]);

  return (
    <div className="p-4 md:p-8 max-w-[1200px] space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          Own-content analytics
        </h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Import your own post metrics — CSV exports from Meta/TikTok/LinkedIn,
          or screenshots for anything else.
        </p>
      </div>

      {/* Weekly summary */}
      {summary.totalPosts > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Total posts tracked"
            value={String(summary.totalPosts)}
          />
          <StatCard
            label="Reach (7d)"
            value={formatNumber(summary.weeklyReach)}
          />
          <StatCard
            label="Engagement (7d)"
            value={formatNumber(summary.weeklyEngagement)}
          />
          <StatCard
            label="Platforms tracked"
            value={String(summary.perPlatform.length)}
          />
        </section>
      )}

      {/* Per-platform breakdown */}
      {summary.perPlatform.length > 0 && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-text-muted" />
            <h2
              className="text-xs uppercase tracking-[0.14em] text-text-muted"
              style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
            >
              By platform
            </h2>
          </div>
          <ul className="divide-y divide-border/30">
            {summary.perPlatform.map((p) => (
              <li key={p.platform} className="py-3 flex items-center justify-between gap-4 flex-wrap">
                <span className="text-foreground font-medium">
                  {PLATFORM_LABEL[p.platform]}
                </span>
                <div className="flex items-center gap-6 text-xs text-text-muted">
                  <span>
                    <span className="text-foreground font-mono">{p.posts}</span>{" "}
                    posts
                  </span>
                  <span>
                    Reach{" "}
                    <span className="text-foreground font-mono">
                      {formatNumber(p.totalReach)}
                    </span>
                  </span>
                  <span>
                    Engagement{" "}
                    <span className="text-foreground font-mono">
                      {formatNumber(p.totalEngagement)}
                    </span>
                  </span>
                  {p.avgEngagementRate > 0 && (
                    <span>
                      Avg ER{" "}
                      <span className="text-foreground font-mono">
                        {p.avgEngagementRate.toFixed(1)}%
                      </span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2
          className="text-xs uppercase tracking-[0.14em] text-text-muted mb-3"
          style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
        >
          Import
        </h2>
        <UploadPanel tenantSlug={tenantSlug} />
      </section>

      <section>
        <h2
          className="text-xs uppercase tracking-[0.14em] text-text-muted mb-3"
          style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
        >
          Recent imports
        </h2>
        <MetricsTable metrics={metrics} tenantSlug={tenantSlug} />
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p
        className="text-xl text-foreground tracking-tight"
        style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
      >
        {value}
      </p>
    </div>
  );
}
