import { cookies } from "next/headers";
import { listTrendScouts } from "@/lib/services/trends";
import { detectCrossBrandPatterns } from "@/lib/services/cross-brand";
import { ViralTrendsClient } from "./client";

export default async function ViralTrendsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [trends, patterns] = await Promise.all([
    listTrendScouts(tenantSlug, { includeDismissed: true, limit: 100 }),
    detectCrossBrandPatterns(),
  ]);

  const tenantPatterns = patterns.filter((p) => p.tenants.includes(tenantSlug));

  return (
    <div className="p-4 md:p-8 max-w-[1000px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          Viral trends
        </h1>
        <p className="text-text-secondary text-sm mt-0.5">
          What&apos;s working in your niche — tracked competitors + broader signals
        </p>
      </div>

      {/* Cross-brand patterns (derived from intel_cards across tenants) */}
      {tenantPatterns.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted mb-3">
            Cross-brand patterns
          </h2>
          <div className="space-y-3">
            {tenantPatterns.slice(0, 3).map((p) => (
              <div
                key={p.id}
                className="bg-card rounded-2xl border border-primary-500/20 p-5"
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-mono text-primary-500 font-semibold">
                    {p.avgMultiplier}x avg
                  </span>
                  <span className="text-text-muted text-xs">·</span>
                  <span className="text-xs uppercase tracking-wide text-text-muted">
                    {p.format}
                  </span>
                </div>
                <p className="text-foreground font-semibold mb-2">{p.pattern}</p>
                <p className="text-sm text-text-secondary leading-relaxed mb-3">
                  {p.recommendation}
                </p>
                <p className="text-xs text-text-muted">{p.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trend scouts (manual + scraped) */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted mb-3">
          Trend scouts
        </h2>
        <ViralTrendsClient trends={trends} tenantSlug={tenantSlug} />
      </section>
    </div>
  );
}
