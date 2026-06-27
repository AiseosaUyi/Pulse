import Link from "next/link";
import { Search, FileText, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { getCurrentTenant } from "@/lib/auth";
import { deriveSEOMetrics, getKeywordRankings } from "@/lib/services/seo";
import { listBlogPosts } from "@/lib/services/blog-posts";
import { KEYWORD_DIFFICULTY_LABELS } from "@/lib/types/seo";
import type { BlogPostStatus } from "@/lib/types/blog-posts";

const statusVariant: Record<BlogPostStatus, "published" | "draft_status" | "planned" | "dismissed"> = {
  draft: "draft_status",
  editing: "draft_status",
  review: "planned",
  published: "published",
  archived: "dismissed",
};

export default async function SEODashboardPage() {
  const tenant = await getCurrentTenant();
  const slug = tenant?.slug ?? "";
  const [keywords, blogPosts] = await Promise.all([
    slug ? getKeywordRankings(slug) : Promise.resolve([]),
    slug ? listBlogPosts(slug) : Promise.resolve([]),
  ]);

  const metrics = deriveSEOMetrics(keywords);
  const topKeywords = keywords.slice(0, 5);
  const recentPosts = blogPosts.slice(0, 3);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {metrics.map((m) => (
          <div key={m.label} className="bg-card rounded-xl p-4 border border-border/50">
            <p className="text-text-secondary text-xs">{m.label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-bold text-foreground">{m.value}</span>
              {m.change !== "—" && (
                <span
                  className={`text-xs font-medium ${m.direction === "up" ? "text-status-green" : m.direction === "down" ? "text-status-red" : "text-text-muted"}`}
                >
                  {m.change}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Link
          href="/seo-tracker/keywords"
          className="bg-card rounded-xl p-5 border border-border/50 hover:border-primary-500/50 transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-3">
            <Search size={20} className="text-primary-500" />
          </div>
          <h3 className="text-foreground font-semibold text-sm group-hover:text-primary-500 transition-colors">
            Research Keywords
          </h3>
          <p className="text-text-muted text-xs mt-1">Discover high-value keyword opportunities with AI</p>
        </Link>
        <Link
          href="/seo-tracker/blog-writer"
          className="bg-card rounded-xl p-5 border border-border/50 hover:border-primary-500/50 transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-3">
            <FileText size={20} className="text-primary-500" />
          </div>
          <h3 className="text-foreground font-semibold text-sm group-hover:text-primary-500 transition-colors">
            Write Blog Post
          </h3>
          <p className="text-text-muted text-xs mt-1">AI-generated SEO-optimized articles with scoring</p>
        </Link>
        <Link
          href="/seo-tracker/serp-analysis"
          className="bg-card rounded-xl p-5 border border-border/50 hover:border-primary-500/50 transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-3">
            <BarChart3 size={20} className="text-primary-500" />
          </div>
          <h3 className="text-foreground font-semibold text-sm group-hover:text-primary-500 transition-colors">
            Analyze SERP
          </h3>
          <p className="text-text-muted text-xs mt-1">Reverse-engineer what ranks and why</p>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <div className="bg-card rounded-xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              SEO Keywords
            </h2>
            <Link href="/seo-tracker/keywords" className="text-xs text-primary-500 hover:underline">
              View all
            </Link>
          </div>
          {topKeywords.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-foreground font-medium">No keywords tracked yet</p>
              <p className="text-text-secondary text-xs mt-1">
                Click &ldquo;Track Keyword&rdquo; to start monitoring positions.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Keyword</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Pos.</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Change</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Diff.</th>
                  <th className="text-right px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Volume</th>
                </tr>
              </thead>
              <tbody>
                {topKeywords.map((kw) => {
                  const pos = kw.position;
                  const prev = kw.previousPosition;
                  const change = pos !== null && prev !== null ? prev - pos : null;
                  return (
                    <tr key={kw.id} className="border-b border-border/20 last:border-0">
                      <td className="px-5 py-2.5 text-sm text-foreground truncate max-w-[220px]">
                        {kw.keyword}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {pos === null ? (
                          <span className="text-text-muted text-sm">—</span>
                        ) : (
                          <span
                            className={`text-sm font-bold ${pos <= 3 ? "text-status-green" : pos <= 10 ? "text-status-yellow" : "text-text-secondary"}`}
                          >
                            #{pos}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {change === null || change === 0 ? (
                          <span className="text-text-muted text-xs">—</span>
                        ) : change > 0 ? (
                          <span className="text-xs text-status-green">↑{change}</span>
                        ) : (
                          <span className="text-xs text-status-red">↓{Math.abs(change)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-text-muted">
                        {KEYWORD_DIFFICULTY_LABELS[kw.difficulty]}
                      </td>
                      <td className="px-5 py-2.5 text-sm text-text-secondary text-right">
                        {kw.volume.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Recent Blog Posts</h2>
            <Link href="/seo-tracker/blog-writer" className="text-xs text-primary-500 hover:underline">
              View all
            </Link>
          </div>
          {recentPosts.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-foreground font-medium">No blog posts yet</p>
              <p className="text-text-secondary text-xs mt-1">
                Head to <Link href="/seo-tracker/blog-writer" className="text-primary-500 hover:underline">Blog Writer</Link> to generate your first draft.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {recentPosts.map((post) => (
                <div key={post.id} className="p-4 hover:bg-card-hover transition-colors">
                  <p className="text-foreground text-sm font-medium truncate">{post.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={statusVariant[post.status]}>{post.status}</Badge>
                    <span className="text-text-muted text-xs">{post.wordCount.toLocaleString()} words</span>
                    <span className="text-text-muted text-xs">·</span>
                    <span className="text-text-muted text-xs">
                      {new Date(post.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {post.targetKeyword && (
                    <p className="text-text-muted text-xs mt-1 truncate">Target: {post.targetKeyword}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
