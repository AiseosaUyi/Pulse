"use client";

import { useState } from "react";
import Link from "next/link";
import { APP_TIME_ZONE } from "@/lib/utils/format";
import { useRouter } from "next/navigation";
import { CalendarClock, Clock, CheckCircle2, AlertCircle, Loader2, ExternalLink, X, PenLine } from "lucide-react";
import { XIcon, LinkedInIcon, InstagramIcon, TikTokIcon, YouTubeIcon } from "@/components/icons/social";
import { cancelScheduledPost } from "@/lib/actions/schedule";

type Post = {
  id: string;
  platform: string;
  content: string;
  status: string;
  scheduled_for: string;
  posted_at: string | null;
  platform_post_url: string | null;
  error_message: string | null;
};

const PLATFORM_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  x: XIcon,
  linkedin: LinkedInIcon,
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  youtube: YouTubeIcon,
};

const PLATFORM_COLORS: Record<string, string> = {
  x: "#000000",
  linkedin: "#0A66C2",
  instagram: "#E1306C",
  tiktok: "#010101",
  youtube: "#FF0000",
};

const STATUS_CONFIG = {
  scheduled: { icon: Clock, label: "Scheduled", className: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-400" },
  publishing: { icon: Loader2, label: "Publishing…", className: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400" },
  published: { icon: CheckCircle2, label: "Published", className: "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/40 dark:border-green-700 dark:text-green-400" },
  failed: { icon: AlertCircle, label: "Failed", className: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-700 dark:text-red-400" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function ScheduleClient({ initialPosts }: { initialPosts: Post[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [filter, setFilter] = useState<"all" | "scheduled" | "published" | "failed">("all");
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const router = useRouter();

  const filtered = filter === "all" ? posts : posts.filter((p) => p.status === filter);

  async function handleCancel(postId: string) {
    setCancelling((s) => new Set(s).add(postId));
    await cancelScheduledPost(postId);
    setPosts((ps) => ps.map((p) => p.id === postId ? { ...p, status: "failed", error_message: "Cancelled by user" } : p));
    setCancelling((s) => { const n = new Set(s); n.delete(postId); return n; });
  }

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Schedule</h1>
        <p className="text-sm text-text-secondary mt-1">Upcoming and recent scheduled posts across all platforms.</p>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "scheduled", "published", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors capitalize",
              filter === f
                ? "border-primary-500 bg-primary-500 text-white"
                : "border-border text-text-muted hover:border-primary-500/50",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <CalendarClock size={32} className="mx-auto mb-3 text-text-muted opacity-40" />
          <p className="text-sm font-medium text-foreground">No {filter === "all" ? "" : filter} posts yet.</p>
          <p className="mt-1 text-xs text-text-muted opacity-70">
            Draft something and schedule it from the Composer.
          </p>
          <Link
            href="/composer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
          >
            <PenLine size={14} />
            Compose a post
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((post) => {
            const PlatformIcon = PLATFORM_ICONS[post.platform];
            const color = PLATFORM_COLORS[post.platform] ?? "#666";
            const statusCfg = STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.scheduled;
            const StatusIcon = statusCfg.icon;
            const isScheduled = post.status === "scheduled";

            return (
              <div key={post.id} className="bg-card border border-border rounded-2xl p-4 flex gap-3">
                {/* Platform icon */}
                <div
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${color}15` }}
                >
                  {PlatformIcon && (
                    <span style={{ color }}>
                      <PlatformIcon size={16} />
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground line-clamp-2">{post.content}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusCfg.className}`}
                      >
                        <StatusIcon size={9} className={post.status === "publishing" ? "animate-spin" : ""} />
                        {statusCfg.label}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-text-muted">
                      {post.status === "published" && post.posted_at
                        ? `Published ${formatDate(post.posted_at)}`
                        : `Scheduled ${formatDate(post.scheduled_for)}`}
                    </span>
                    {post.platform_post_url && (
                      <a
                        href={post.platform_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        View post <ExternalLink size={10} />
                      </a>
                    )}
                    {post.error_message && (
                      <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-[200px]" title={post.error_message}>
                        {post.error_message}
                      </span>
                    )}
                    {isScheduled && (
                      <button
                        onClick={() => handleCancel(post.id)}
                        disabled={cancelling.has(post.id)}
                        className="ml-auto flex items-center gap-1 text-xs text-text-muted hover:text-red-600 transition-colors"
                      >
                        <X size={11} />
                        {cancelling.has(post.id) ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
