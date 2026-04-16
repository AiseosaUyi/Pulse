import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { mockWeeklyReport } from "@/lib/data/mock-engagement";
import { formatCurrency } from "@/lib/utils/format";
import { getTenant } from "@/lib/services/tenants";

export default async function WeeklyReportPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const report = mockWeeklyReport[tenantSlug] ?? mockWeeklyReport.gruve;
  const tenant = await getTenant(tenantSlug);
  const currency = tenant?.currency ?? "NGN";

  return (
    <div className="p-4 md:p-8 max-w-[900px]">
      <div className="flex items-center gap-3 mb-6 md:mb-8">
        <Link href="/dashboard" className="text-text-muted hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Weekly Report</h1>
          <p className="text-text-secondary text-sm mt-0.5">{report.weekLabel}</p>
        </div>
      </div>

      {/* Highlights */}
      <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white mb-4">This Week's Highlights</h2>
        <div className="space-y-2.5">
          {report.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full gradient-purple-pink flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <p className="text-text-secondary text-sm leading-relaxed">{h}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-5 border border-border/50">
          <p className="text-text-secondary text-xs">Social Reach</p>
          <p className="text-3xl font-bold text-white mt-1">{(report.socialReach.value / 1000).toFixed(1)}K</p>
          <p className="text-status-green text-xs font-medium mt-1">+{report.socialReach.change}% vs last week</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border/50">
          <p className="text-text-secondary text-xs">Engagements</p>
          <p className="text-3xl font-bold text-white mt-1">{report.engagement.value.toLocaleString()}</p>
          <p className="text-status-green text-xs font-medium mt-1">+{report.engagement.change}% vs last week</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border/50">
          <p className="text-text-secondary text-xs">New Followers</p>
          <p className="text-3xl font-bold text-white mt-1">{report.newFollowers.value}</p>
          <p className="text-status-green text-xs font-medium mt-1">+{report.newFollowers.change}% vs last week</p>
        </div>
      </div>

      {/* Top Post */}
      <div className="bg-card rounded-xl p-6 border border-accent-purple/30 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-purple mb-3">Top Performing Post</h2>
        <p className="text-white text-lg font-semibold">{report.topPost.title}</p>
        <div className="flex items-center gap-4 mt-2 text-sm text-text-secondary">
          <span>{report.topPost.platform}</span>
          <span>·</span>
          <span>{report.topPost.reach.toLocaleString()} reach</span>
          <span>·</span>
          <span className="text-status-green">{report.topPost.engagement} engagement</span>
        </div>
      </div>

      {/* Platform Performance */}
      <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white mb-4">Platform Performance</h2>
        <div className="space-y-3">
          {report.platformPerformance.map((p) => (
            <div key={p.platform} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
              <span className="text-white text-sm font-medium w-24">{p.platform}</span>
              <span className="text-text-secondary text-sm">{p.posts} posts</span>
              <span className="text-text-secondary text-sm">{p.reach > 0 ? `${(p.reach / 1000).toFixed(1)}K reach` : "No reach"}</span>
              <span className={`text-sm font-medium ${p.engagement !== "0%" ? "text-status-green" : "text-text-muted"}`}>{p.engagement} eng.</span>
              <span className={`text-xs ${p.trend === "up" ? "text-status-green" : p.trend === "down" ? "text-status-red" : "text-text-muted"}`}>
                {p.trend === "up" ? "↑ Trending up" : p.trend === "down" ? "↓ Declining" : "→ Stable"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50 text-center">
          <p className="text-text-secondary text-xs">Leads Generated</p>
          <p className="text-xl font-bold text-white mt-1">{report.leadsGenerated}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50 text-center">
          <p className="text-text-secondary text-xs">Ad Spend</p>
          <p className="text-xl font-bold text-white mt-1">{report.adSpend > 0 ? formatCurrency(report.adSpend, currency) : "Paused"}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50 text-center">
          <p className="text-text-secondary text-xs">SEO Keywords Up</p>
          <p className="text-xl font-bold text-status-green mt-1">{report.seoKeywordsImproved}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50 text-center">
          <p className="text-text-secondary text-xs">Content Published</p>
          <p className="text-xl font-bold text-accent-purple mt-1">{report.contentPublished}</p>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-card rounded-xl p-6 border border-border/50">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white mb-4">PULSE Recommendations for Next Week</h2>
        <div className="space-y-3">
          {report.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background">
              <span className="text-accent-purple text-sm font-bold mt-0.5">{i + 1}.</span>
              <p className="text-text-secondary text-sm leading-relaxed">{rec}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
