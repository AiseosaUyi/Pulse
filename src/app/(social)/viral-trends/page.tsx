import { cookies } from "next/headers";
import { mockTrends } from "@/lib/data/mock-modules";
import { Badge } from "@/components/ui/Badge";

export default async function ViralTrendsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const data = mockTrends[tenantSlug] ?? mockTrends.gruve;

  const typeIcons: Record<string, string> = { video: "▶", image: "◻", carousel: "⊞", text: "¶" };

  return (
    <div className="p-8 max-w-[1200px]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Viral Trends</h1>
        <p className="text-text-secondary text-sm mt-0.5">Trending hashtags and top-performing content</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Trending Hashtags */}
        <div className="bg-card rounded-xl p-6 border border-border/50">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white mb-5">Trending Hashtags</h2>
          <div className="space-y-3">
            {data.hashtags.map((tag) => (
              <div key={tag.tag} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-accent-purple font-semibold text-sm">{tag.tag}</span>
                  <Badge variant={tag.relevance === "high" ? "high_impact" : "opportunity"}>
                    {tag.relevance}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-text-secondary text-xs">{tag.posts.toLocaleString()} posts</p>
                  <p className="text-status-green text-xs font-medium">{tag.growth}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Content */}
        <div className="bg-card rounded-xl p-6 border border-border/50">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white mb-5">Top Performing Content</h2>
          <div className="space-y-4">
            {data.topContent.map((c, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-card-hover transition-colors">
                <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-lg flex-shrink-0">
                  {typeIcons[c.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{c.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-text-muted text-xs">{c.platform}</span>
                    <span className="text-text-muted text-xs">·</span>
                    <span className="text-text-muted text-xs">{c.date}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-sm font-semibold">{c.reach}</p>
                  <p className="text-status-green text-xs">{c.engagement} eng.</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content Type Performance */}
      <div className="bg-card rounded-xl p-6 border border-border/50 mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white mb-5">Content Type Performance</h2>
        <div className="grid grid-cols-4 gap-4">
          {[
            { type: "Video", icon: "▶", avgReach: "3.5K", avgEng: "10.2%" },
            { type: "Carousel", icon: "⊞", avgReach: "2.6K", avgEng: "6.8%" },
            { type: "Image", icon: "◻", avgReach: "1.8K", avgEng: "4.2%" },
            { type: "Text", icon: "¶", avgReach: "1.2K", avgEng: "3.1%" },
          ].map((item) => (
            <div key={item.type} className="text-center p-4 rounded-lg bg-background">
              <div className="text-2xl mb-2">{item.icon}</div>
              <p className="text-white font-semibold text-sm">{item.type}</p>
              <p className="text-text-secondary text-xs mt-1">Avg. reach: {item.avgReach}</p>
              <p className="text-status-green text-xs">Avg. eng: {item.avgEng}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
