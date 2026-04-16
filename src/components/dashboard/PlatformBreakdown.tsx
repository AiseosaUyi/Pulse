import { Badge } from "@/components/ui/Badge";
import type { PlatformConnection } from "@/lib/types/tenant";

interface PlatformBreakdownProps {
  platforms: PlatformConnection[];
}

const platformIcons: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  twitter: "✦",
  linkedin: "💼",
};

const platformNames: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
};

const statusToBadge: Record<string, "active" | "needs_posts" | "low_activity"> = {
  active: "active",
  needs_posts: "needs_posts",
  low_activity: "low_activity",
};

function formatFollowers(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, ",")}${count >= 1000 ? "" : ""}`;
  return count.toLocaleString();
}

export function PlatformBreakdown({ platforms }: PlatformBreakdownProps) {
  const connectedPlatforms = platforms.filter((p) => p.connected);

  if (connectedPlatforms.length === 0) {
    return (
      <div className="bg-card rounded-xl p-6 border border-border/50">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">
          Platform Breakdown
        </h2>
        <div className="text-center py-8">
          <p className="text-text-secondary text-sm">No platforms connected</p>
          <p className="text-text-muted text-xs mt-1">
            Connect your first platform to see analytics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-6 border border-border/50">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-5">
        Platform Breakdown
      </h2>
      <div className="flex flex-col gap-5">
        {connectedPlatforms.map((platform) => (
          <div
            key={platform.platform}
            className="flex items-start gap-3 group"
          >
            {/* Platform icon */}
            <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-lg flex-shrink-0">
              {platformIcons[platform.platform]}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <span className="font-semibold text-foreground text-sm">
                  {platformNames[platform.platform]}
                </span>
                {platform.status !== "inactive" && (
                  <Badge variant={statusToBadge[platform.status] ?? "active"}>
                    {platform.status === "active"
                      ? "Active"
                      : platform.status === "needs_posts"
                        ? "Needs posts"
                        : "Low activity"}
                  </Badge>
                )}
              </div>
              <p className="text-text-secondary text-xs">
                {platform.followers.toLocaleString()} followers &middot;{" "}
                {platform.engagementRate}% engagement
              </p>

              {/* Progress bar */}
              <div className="mt-2 h-1 bg-border/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full gradient-purple-pink transition-all duration-500"
                  style={{
                    width: `${Math.min(platform.engagementRate * 10, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlatformBreakdownSkeleton() {
  return (
    <div className="bg-card rounded-xl p-6 border border-border/50">
      <div className="h-4 w-40 bg-border/50 rounded animate-skeleton mb-5" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-border/50 animate-skeleton" />
          <div className="flex-1">
            <div className="h-4 w-24 bg-border/50 rounded animate-skeleton mb-2" />
            <div className="h-3 w-40 bg-border/50 rounded animate-skeleton mb-2" />
            <div className="h-1 w-full bg-border/50 rounded animate-skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}
