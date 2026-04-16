import { cookies } from "next/headers";
import { mockSavedContent, mockTrendingContent } from "@/lib/data/mock-content-vault";
import { Badge } from "@/components/ui/Badge";
import { ContentExtractor } from "./content-extractor";

export default async function ContentVaultPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const saved = mockSavedContent[tenantSlug] ?? mockSavedContent.gruve;
  const trending = mockTrendingContent[tenantSlug] ?? mockTrendingContent.gruve;

  const platformColors: Record<string, string> = {
    tiktok: "text-accent-pink",
    instagram: "text-accent-purple",
    twitter: "text-status-teal",
    youtube: "text-status-red",
    manual: "text-text-muted",
  };

  const usedCount = saved.filter((c) => c.status === "used").length;
  const scheduledCount = saved.filter((c) => c.status === "scheduled").length;

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content Vault</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Save, extract, and organize content for your platforms
          </p>
        </div>
      </div>

      {/* Link Extractor */}
      <ContentExtractor />

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Saved</p>
          <p className="text-2xl font-bold text-foreground mt-1">{saved.length}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Ready to Use</p>
          <p className="text-2xl font-bold text-status-green mt-1">{saved.length - usedCount - scheduledCount}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Used</p>
          <p className="text-2xl font-bold text-accent-purple mt-1">{usedCount}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Scheduled</p>
          <p className="text-2xl font-bold text-status-yellow mt-1">{scheduledCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
        {/* Saved Content - takes 3 columns */}
        <div className="col-span-1 lg:col-span-3">
          <div className="bg-card rounded-xl border border-border/50">
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Saved Content
              </h2>
              <div className="flex gap-2">
                <button className="px-2.5 py-1 text-xs bg-background rounded-md text-text-secondary hover:text-foreground transition-colors">All</button>
                <button className="px-2.5 py-1 text-xs bg-background rounded-md text-text-secondary hover:text-foreground transition-colors">Videos</button>
                <button className="px-2.5 py-1 text-xs bg-background rounded-md text-text-secondary hover:text-foreground transition-colors">Memes</button>
                <button className="px-2.5 py-1 text-xs bg-background rounded-md text-text-secondary hover:text-foreground transition-colors">Images</button>
              </div>
            </div>
            <div className="divide-y divide-border/30">
              {saved.map((content) => (
                <div key={content.id} className="p-4 hover:bg-card-hover transition-colors">
                  <div className="flex items-start gap-3">
                    {/* Thumbnail */}
                    <div className="w-14 h-14 rounded-lg bg-background flex items-center justify-center text-2xl flex-shrink-0">
                      {content.thumbnailEmoji}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-foreground text-sm font-medium leading-tight">
                            {content.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs font-medium ${platformColors[content.sourcePlatform]}`}>
                              {content.sourcePlatform === "manual" ? "Uploaded" : content.sourcePlatform}
                            </span>
                            {content.duration && (
                              <>
                                <span className="text-text-muted text-xs">·</span>
                                <span className="text-text-muted text-xs">{content.duration}</span>
                              </>
                            )}
                            <span className="text-text-muted text-xs">·</span>
                            <span className="text-text-muted text-xs">{content.savedAt}</span>
                          </div>
                        </div>
                        <Badge variant={
                          content.status === "used" ? "active" :
                          content.status === "scheduled" ? "opportunity" :
                          "high_impact"
                        }>
                          {content.status}
                        </Badge>
                      </div>

                      {/* Tags + platform targets */}
                      <div className="flex items-center gap-2 mt-2">
                        {content.watermarkRemoved && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-status-green/10 text-status-green">
                            Watermark removed
                          </span>
                        )}
                        <span className="text-text-muted text-[10px]">
                          Best for: {content.bestFor.join(", ")}
                        </span>
                      </div>

                      {/* Tags */}
                      <div className="flex gap-1.5 mt-2">
                        {content.tags.map((tag) => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-background text-text-muted text-[10px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trending Content - takes 2 columns */}
        <div className="col-span-1 lg:col-span-2">
          <div className="bg-card rounded-xl border border-border/50">
            <div className="p-5 border-b border-border/50">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Trending in Your Niche
              </h2>
              <p className="text-text-muted text-xs mt-1">Content formats going viral right now</p>
            </div>
            <div className="divide-y divide-border/30">
              {trending.map((item) => (
                <div key={item.id} className="p-4 hover:bg-card-hover transition-colors group">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-lg flex-shrink-0">
                      {item.thumbnailEmoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground text-sm font-medium leading-tight group-hover:text-accent-purple transition-colors">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-text-muted text-xs">{item.platform}</span>
                        <span className="text-text-muted text-xs">·</span>
                        <span className="text-text-muted text-xs">{item.views} views</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 bg-border/50 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full gradient-purple-pink"
                            style={{ width: `${item.viralScore}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-muted">{item.viralScore}%</span>
                        <Badge variant={item.relevance === "high" ? "high_impact" : "opportunity"}>
                          {item.relevance}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <button className="mt-2 ml-[52px] px-3 py-1 text-xs bg-accent-purple/10 text-accent-purple rounded-md hover:bg-accent-purple/20 transition-colors opacity-0 group-hover:opacity-100">
                    Save to Vault
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
