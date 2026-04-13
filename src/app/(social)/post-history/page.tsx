import { cookies } from "next/headers";
import { mockPostedContent } from "@/lib/data/mock-engagement";
import { Badge } from "@/components/ui/Badge";

export default async function PostHistoryPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const posts = mockPostedContent[tenantSlug] ?? mockPostedContent.gruve;

  const totalReach = posts.reduce((sum, p) => sum + p.reach, 0);
  const avgEngagement = posts.length > 0 ? (posts.reduce((sum, p) => sum + p.engagementRate, 0) / posts.length).toFixed(1) : "0";
  const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);
  const aboveAvg = posts.filter((p) => p.performanceVsAvg === "above").length;

  const platformColors: Record<string, string> = { instagram: "text-accent-purple", tiktok: "text-accent-pink", twitter: "text-status-teal", linkedin: "text-blue-400" };
  const perfBadge: Record<string, { variant: "active" | "opportunity" | "overdue"; label: string }> = {
    above: { variant: "active", label: "Above avg" },
    average: { variant: "opportunity", label: "Average" },
    below: { variant: "overdue", label: "Below avg" },
  };

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Post History</h1>
        <p className="text-text-secondary text-sm mt-0.5">Content performance over time</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Reach</p>
          <p className="text-2xl font-bold text-white mt-1">{(totalReach / 1000).toFixed(1)}K</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Avg. Engagement</p>
          <p className="text-2xl font-bold text-status-green mt-1">{avgEngagement}%</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Likes</p>
          <p className="text-2xl font-bold text-accent-purple mt-1">{totalLikes.toLocaleString()}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Above Average</p>
          <p className="text-2xl font-bold text-white mt-1">{aboveAvg}/{posts.length}</p>
        </div>
      </div>

      {/* Posts table */}
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <div className="bg-card rounded-xl border border-border/50 overflow-hidden min-w-[800px] md:min-w-0">
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
                    <span className="text-xs px-1.5 py-0.5 rounded bg-background text-text-muted capitalize">{post.type}</span>
                    <span className="text-sm text-white font-medium truncate max-w-[220px]">{post.title}</span>
                  </div>
                </td>
                <td className={`px-3 py-3.5 text-sm font-medium ${platformColors[post.platform]}`}>{post.platform}</td>
                <td className="px-3 py-3.5 text-sm text-text-secondary">{post.postedAt}</td>
                <td className="px-3 py-3.5 text-sm text-white text-right">{post.reach.toLocaleString()}</td>
                <td className="px-3 py-3.5 text-sm text-text-secondary text-right">{post.likes.toLocaleString()}</td>
                <td className="px-3 py-3.5 text-sm text-text-secondary text-right">{post.comments}</td>
                <td className="px-3 py-3.5 text-sm text-text-secondary text-right">{post.shares}</td>
                <td className="px-3 py-3.5 text-sm text-right">
                  <span className={`font-semibold ${post.engagementRate >= 8 ? "text-status-green" : post.engagementRate >= 4 ? "text-status-yellow" : "text-status-red"}`}>
                    {post.engagementRate}%
                  </span>
                </td>
                <td className="px-5 py-3.5 text-center">
                  <Badge variant={perfBadge[post.performanceVsAvg].variant}>{perfBadge[post.performanceVsAvg].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
