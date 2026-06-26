import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPosts, summarize } from "@/lib/services/posts";
import {
  POST_CONTENT_TYPE_LABELS,
  POST_PLATFORM_LABELS,
  type PostPerformance,
  type PostPlatform,
} from "@/lib/types/posts";
import { AddPostButton } from "./client";

const PULSE_PLATFORM_COLORS: Record<string, string> = {
  linkedin: "text-blue-500",
  instagram: "text-primary-500",
  tiktok: "text-foreground",
  youtube: "text-red-500",
  x: "text-foreground",
};

const platformColors: Record<PostPlatform, string> = {
  instagram: "text-primary-500",
  tiktok: "text-foreground",
  twitter: "text-status-teal",
  linkedin: "text-blue-500",
};

const perfBadge: Record<PostPerformance, { variant: "active" | "opportunity" | "overdue"; label: string }> = {
  above: { variant: "active", label: "Above avg" },
  average: { variant: "opportunity", label: "Average" },
  below: { variant: "overdue", label: "Below avg" },
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const [, y, m, d] = match;
  return dateFormatter.format(new Date(Number(y), Number(m) - 1, Number(d)));
}

function formatReach(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export default async function PostHistoryPage() {
  const tenant = await getCurrentTenant();
  const posts = tenant ? await getPosts(tenant.slug) : [];
  const summary = summarize(posts);

  const admin = createAdminClient();
  const { data: pulsePosts } = tenant
    ? await admin
        .from("scheduled_posts")
        .select("id, platform, content, scheduled_for, posted_at, platform_post_url, status")
        .eq("tenant_slug", tenant.slug)
        .eq("status", "published")
        .order("posted_at", { ascending: false })
        .limit(50)
    : { data: [] };
  const publishedViaPulse = pulsePosts ?? [];

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Post History</h1>
          <p className="text-text-secondary text-sm mt-0.5">Content performance over time</p>
        </div>
        <AddPostButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Reach</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatReach(summary.totalReach)}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Avg. Engagement</p>
          <p className="text-2xl font-bold text-status-green mt-1">{summary.avgEngagement}%</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Likes</p>
          <p className="text-2xl font-bold text-primary-500 mt-1">{summary.totalLikes.toLocaleString()}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Above Average</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {summary.aboveAvg}/{summary.total}
          </p>
        </div>
      </div>

      {publishedViaPulse.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold text-foreground mb-3">Published via Pulse</h2>
          <div className="flex flex-col gap-2">
            {publishedViaPulse.map((post) => {
              const postedDate = post.posted_at
                ? new Date(post.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : new Date(post.scheduled_for).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              const platformColor = PULSE_PLATFORM_COLORS[post.platform] ?? "text-text-muted";
              return (
                <div key={post.id} className="bg-card rounded-xl border border-border/50 px-4 py-3 flex items-start gap-3">
                  <span className={`text-xs font-semibold uppercase tracking-wide shrink-0 mt-0.5 w-16 ${platformColor}`}>
                    {post.platform}
                  </span>
                  <p className="text-sm text-foreground flex-1 line-clamp-2 min-w-0">
                    {(post.content as string)?.slice(0, 120) ?? "—"}
                  </p>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-text-muted">{postedDate}</span>
                    {post.platform_post_url && (
                      <a
                        href={post.platform_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary-500 hover:underline"
                      >
                        View <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {posts.length === 0 && publishedViaPulse.length === 0 ? (
        <div className="bg-card rounded-xl border border-border/50 p-10 text-center max-w-lg mx-auto">
          <p className="text-sm font-semibold text-foreground mb-2">No posts logged yet</p>
          <p className="text-text-secondary text-xs leading-relaxed mb-5">
            Once you start posting via Pulse, your history appears here automatically.
          </p>
          <Link
            href="/composer"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
          >
            Compose a post →
          </Link>
        </div>
      ) : posts.length === 0 ? null : (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <div className="bg-card rounded-xl border border-border/50 overflow-hidden min-w-[900px] md:min-w-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Post</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Platform</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Date</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Reach</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Likes</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Comments</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Shares</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Eng. Rate</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Perf.</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-border/30 last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-background text-text-muted">
                          {POST_CONTENT_TYPE_LABELS[post.contentType]}
                        </span>
                        {post.postUrl ? (
                          <a
                            href={post.postUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-foreground font-medium truncate max-w-[220px] hover:underline"
                          >
                            {post.title}
                          </a>
                        ) : (
                          <span className="text-sm text-foreground font-medium truncate max-w-[220px]">
                            {post.title}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`px-3 py-3.5 text-sm font-medium ${platformColors[post.platform]}`}>
                      {POST_PLATFORM_LABELS[post.platform]}
                    </td>
                    <td className="px-3 py-3.5 text-sm text-text-secondary">{formatDate(post.postedAt)}</td>
                    <td className="px-3 py-3.5 text-sm text-foreground text-right">{post.reach.toLocaleString()}</td>
                    <td className="px-3 py-3.5 text-sm text-text-secondary text-right">{post.likes.toLocaleString()}</td>
                    <td className="px-3 py-3.5 text-sm text-text-secondary text-right">{post.comments}</td>
                    <td className="px-3 py-3.5 text-sm text-text-secondary text-right">{post.shares}</td>
                    <td className="px-3 py-3.5 text-sm text-right">
                      <span
                        className={`font-semibold ${
                          post.engagementRate >= 8
                            ? "text-status-green"
                            : post.engagementRate >= 4
                              ? "text-status-yellow"
                              : "text-status-red"
                        }`}
                      >
                        {post.engagementRate}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <Badge variant={perfBadge[post.performanceVsAvg].variant}>
                        {perfBadge[post.performanceVsAvg].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
