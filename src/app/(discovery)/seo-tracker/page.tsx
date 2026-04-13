import { cookies } from "next/headers";
import Link from "next/link";
import { Search, FileText, BarChart3 } from "lucide-react";
import { getSEOMetrics, getKeywordRankings, getBlogPosts } from "@/lib/services/seo";
import { ContentScoreRing } from "@/components/seo/ContentScoreRing";
import { Badge } from "@/components/ui/Badge";

export default async function SEODashboardPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [metrics, keywords, blogPosts] = await Promise.all([
    getSEOMetrics(tenantSlug),
    getKeywordRankings(tenantSlug),
    getBlogPosts(tenantSlug),
  ]);

  const topKeywords = keywords.slice(0, 5);
  const recentPosts = blogPosts.slice(0, 3);

  const statusVariant: Record<string, "published" | "draft_status" | "planned" | "gap"> = {
    published: "published",
    editing: "draft_status",
    review: "planned",
    generated: "planned",
  };

  return (
    <div>
      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {metrics.map((m) => (
          <div key={m.label} className="bg-card rounded-xl p-4 border border-border/50">
            <p className="text-text-secondary text-xs">{m.label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-bold text-white">{m.value}</span>
              <span className={`text-xs font-medium ${m.direction === "up" ? "text-status-green" : "text-status-red"}`}>
                {m.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Link href="/seo-tracker/keywords" className="bg-card rounded-xl p-5 border border-border/50 hover:border-accent-purple/50 transition-colors group">
          <div className="w-10 h-10 rounded-lg bg-accent-purple/10 flex items-center justify-center mb-3">
            <Search size={20} className="text-accent-purple" />
          </div>
          <h3 className="text-white font-semibold text-sm group-hover:text-accent-purple transition-colors">Research Keywords</h3>
          <p className="text-text-muted text-xs mt-1">Discover high-value keyword opportunities with AI</p>
        </Link>
        <Link href="/seo-tracker/blog-writer" className="bg-card rounded-xl p-5 border border-border/50 hover:border-accent-purple/50 transition-colors group">
          <div className="w-10 h-10 rounded-lg bg-accent-pink/10 flex items-center justify-center mb-3">
            <FileText size={20} className="text-accent-pink" />
          </div>
          <h3 className="text-white font-semibold text-sm group-hover:text-accent-purple transition-colors">Write Blog Post</h3>
          <p className="text-text-muted text-xs mt-1">AI-generated SEO-optimized articles with scoring</p>
        </Link>
        <Link href="/seo-tracker/serp-analysis" className="bg-card rounded-xl p-5 border border-border/50 hover:border-accent-purple/50 transition-colors group">
          <div className="w-10 h-10 rounded-lg bg-status-teal/10 flex items-center justify-center mb-3">
            <BarChart3 size={20} className="text-status-teal" />
          </div>
          <h3 className="text-white font-semibold text-sm group-hover:text-accent-purple transition-colors">Analyze SERP</h3>
          <p className="text-text-muted text-xs mt-1">Reverse-engineer what ranks and why</p>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Top Keywords */}
        <div className="bg-card rounded-xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Top Keywords</h2>
            <Link href="/seo-tracker/keywords" className="text-xs text-accent-purple hover:underline">View all</Link>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Keyword</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Pos.</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Change</th>
                <th className="text-right px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Volume</th>
              </tr>
            </thead>
            <tbody>
              {topKeywords.map((kw) => {
                const change = kw.previousPosition - kw.position;
                return (
                  <tr key={kw.keyword} className="border-b border-border/20 last:border-0">
                    <td className="px-5 py-2.5 text-sm text-white">{kw.keyword}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-sm font-bold ${kw.position <= 3 ? "text-status-green" : kw.position <= 10 ? "text-status-yellow" : "text-text-secondary"}`}>
                        #{kw.position}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs ${change > 0 ? "text-status-green" : "text-text-muted"}`}>
                        {change > 0 ? `↑${change}` : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-sm text-text-secondary text-right">{kw.volume.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Recent Blog Posts */}
        <div className="bg-card rounded-xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Recent Blog Posts</h2>
            <Link href="/seo-tracker/blog-writer" className="text-xs text-accent-purple hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-border/30">
            {recentPosts.map((post) => (
              <div key={post.id} className="p-4 hover:bg-card-hover transition-colors">
                <div className="flex items-start gap-3">
                  <ContentScoreRing score={post.contentScore} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{post.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={statusVariant[post.status] ?? "planned"}>
                        {post.status}
                      </Badge>
                      <span className="text-text-muted text-xs">{post.wordCount.toLocaleString()} words</span>
                      <span className="text-text-muted text-xs">·</span>
                      <span className="text-text-muted text-xs">{post.createdAt}</span>
                    </div>
                    <p className="text-text-muted text-xs mt-1 truncate">Target: {post.targetKeyword}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
