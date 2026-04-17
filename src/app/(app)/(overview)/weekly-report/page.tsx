import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles, TrendingUp, Target, Search, Users, Zap } from "lucide-react";
import { getLatestDigest } from "@/lib/services/insights";
import { GenerateDigestButton } from "./client";
import type {
  RecommendedAction,
  WeeklyDigestRecord,
} from "@/lib/types/insights";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const MODULE_ICON: Record<NonNullable<RecommendedAction["target_module"]>, typeof ArrowRight> = {
  "/intel-feed": Search,
  "/viral-trends": TrendingUp,
  "/content-briefs": Sparkles,
  "/own-analytics": Zap,
  "/seo-tracker": Search,
  "/leads": Users,
  "/ai-content": Sparkles,
};

const MODULE_LABEL: Record<NonNullable<RecommendedAction["target_module"]>, string> = {
  "/intel-feed": "Intel feed",
  "/viral-trends": "Viral trends",
  "/content-briefs": "Content briefs",
  "/own-analytics": "Own analytics",
  "/seo-tracker": "SEO tracker",
  "/leads": "Leads",
  "/ai-content": "AI content",
};

export default async function WeeklyReportPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const digest = await getLatestDigest(tenantSlug);

  return (
    <div className="p-4 md:p-8 max-w-[1000px]">
      <div className="flex items-center justify-between mb-6 md:mb-8 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">
              Weekly report
            </h1>
            <p className="text-text-secondary text-sm mt-0.5">
              {digest
                ? `Week of ${new Date(digest.weekOf).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                : "No digest yet — synthesize one now"}
            </p>
          </div>
        </div>
        <GenerateDigestButton tenantSlug={tenantSlug} hasDigest={digest !== null} />
      </div>

      {!digest ? (
        <EmptyDigest />
      ) : (
        <DigestView digest={digest} />
      )}
    </div>
  );
}

function EmptyDigest() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
      <Sparkles size={24} className="mx-auto text-text-muted mb-3" />
      <h3 className="text-foreground font-semibold mb-1">No weekly digest yet</h3>
      <p className="text-text-muted text-sm max-w-md mx-auto">
        Click &quot;Generate digest&quot; to synthesize this week&apos;s intel,
        trends, own-post metrics, SEO, and leads into a strategic brief with
        3–5 priority actions.
      </p>
    </div>
  );
}

function DigestView({ digest }: { digest: WeeklyDigestRecord }) {
  const own = digest.ownPerformance;
  const seo = digest.seoSummary;
  const leads = digest.leadsSummary;

  return (
    <div className="space-y-6">
      {/* Strategic brief */}
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-xs uppercase tracking-[0.14em] text-text-muted mb-3 font-semibold">
          Strategic brief
        </h2>
        <p className="text-foreground leading-relaxed whitespace-pre-wrap">
          {digest.strategicBrief ?? "(no narrative generated)"}
        </p>
      </section>

      {/* Recommended actions */}
      {digest.recommendedActions.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-[0.14em] text-text-muted mb-3 font-semibold">
            Recommended actions
          </h2>
          <div className="space-y-3">
            {digest.recommendedActions
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((a, i) => {
                const Icon = a.target_module ? MODULE_ICON[a.target_module] : Target;
                return (
                  <div
                    key={i}
                    className="bg-card rounded-xl border border-border p-5 flex items-start gap-4"
                  >
                    <div
                      className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                        a.priority === 1
                          ? "bg-primary-500 text-white"
                          : a.priority === 2
                          ? "bg-warning-50 text-warning-500 border border-warning-500/20"
                          : "bg-sidebar text-text-muted border border-border"
                      }`}
                    >
                      P{a.priority}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-medium">{a.action}</p>
                      <p className="text-sm text-text-secondary mt-1">
                        {a.rationale}
                      </p>
                      {a.target_module && (
                        <Link
                          href={a.target_module}
                          className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline mt-2"
                        >
                          <Icon size={12} />
                          Open {MODULE_LABEL[a.target_module]}
                          <ArrowRight size={12} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Performance metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {own && (
          <section className="bg-card rounded-2xl border border-border p-5">
            <h3 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-3">
              Own performance
            </h3>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(own.reach_this_week)}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              reach this week ({own.posts_this_week} posts)
            </p>
            {own.pct_change !== null && (
              <p
                className={`text-sm font-medium mt-2 ${
                  own.pct_change > 0
                    ? "text-status-green"
                    : own.pct_change < 0
                    ? "text-status-red"
                    : "text-text-muted"
                }`}
              >
                {own.pct_change > 0 ? "+" : ""}
                {own.pct_change}% vs prior week
              </p>
            )}
            {own.top_post && (
              <p className="text-xs text-text-muted mt-3 truncate">
                Top: {own.top_post.title ?? "(untitled)"} · {formatNumber(own.top_post.reach)}
              </p>
            )}
          </section>
        )}
        {seo && (
          <section className="bg-card rounded-2xl border border-border p-5">
            <h3 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-3">
              SEO
            </h3>
            <p className="text-2xl font-bold text-foreground">
              {seo.top10}
              <span className="text-sm text-text-muted font-medium"> / {seo.tracked_total}</span>
            </p>
            <p className="text-xs text-text-muted mt-0.5">top 10 / tracked</p>
            <div className="flex items-center gap-3 mt-2 text-sm">
              <span className="text-status-green">↑ {seo.rising}</span>
              <span className="text-status-red">↓ {seo.declining}</span>
            </div>
            {seo.avg_position !== null && (
              <p className="text-xs text-text-muted mt-2">
                Avg pos {seo.avg_position}
                {seo.avg_position_change !== null &&
                  ` (${seo.avg_position_change > 0 ? "+" : ""}${seo.avg_position_change})`}
              </p>
            )}
          </section>
        )}
        {leads && (
          <section className="bg-card rounded-2xl border border-border p-5">
            <h3 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-3">
              Leads
            </h3>
            <p className="text-2xl font-bold text-foreground">
              {leads.total_active}
            </p>
            <p className="text-xs text-text-muted mt-0.5">active in pipeline</p>
            <div className="text-sm text-text-muted mt-2 space-y-0.5">
              <p>{leads.new_warm} new warm</p>
              {leads.needs_followup > 0 && (
                <p className="text-status-yellow">{leads.needs_followup} need follow-up</p>
              )}
              {leads.converted_this_week > 0 && (
                <p className="text-status-green">+{leads.converted_this_week} converted</p>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Top competitor moves */}
      {digest.topCompetitorMoves.length > 0 && (
        <section className="bg-card rounded-2xl border border-border p-5">
          <h2 className="text-xs uppercase tracking-[0.14em] text-text-muted mb-3 font-semibold">
            Top competitor moves
          </h2>
          <ul className="space-y-3">
            {digest.topCompetitorMoves.map((m) => (
              <li key={m.intel_card_id} className="text-sm">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-foreground font-semibold">
                    {m.competitor_name}
                  </span>
                  <span className="text-text-muted text-xs">·</span>
                  <span className="text-text-muted text-xs">
                    {m.platform} {m.content_type}
                  </span>
                  {m.multiplier !== null && (
                    <span className="text-xs font-mono text-primary-500">
                      {m.multiplier.toFixed(1)}x
                    </span>
                  )}
                </div>
                <p className="text-text-secondary">{m.why_notable}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Winning formats */}
      {digest.winningFormats.length > 0 && (
        <section className="bg-card rounded-2xl border border-border p-5">
          <h2 className="text-xs uppercase tracking-[0.14em] text-text-muted mb-3 font-semibold">
            Formats winning across brands
          </h2>
          <ul className="space-y-3">
            {digest.winningFormats.map((f, i) => (
              <li key={i} className="text-sm flex items-start gap-3">
                <span className="text-sm font-mono text-primary-500 shrink-0 font-semibold">
                  {f.multiplier}x
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium">{f.format}</p>
                  <p className="text-text-muted text-xs mt-0.5">{f.evidence}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-text-muted text-right">
        Generated {new Date(digest.generatedAt).toLocaleString()} · {digest.generatorModel}
      </p>
    </div>
  );
}
