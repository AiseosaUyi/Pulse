import { cookies } from "next/headers";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { listBriefs } from "@/lib/services/briefs";
import {
  listScheduledPosts,
  buildCalendarWeek,
} from "@/lib/services/scheduled-posts";
import { AIContentClient } from "./client";

export default async function AIContentPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const [briefs, scheduled] = await Promise.all([
    listBriefs(tenantSlug, { limit: 20 }),
    listScheduledPosts(tenantSlug, {
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
    }),
  ]);

  const calendar = buildCalendarWeek(scheduled, weekStart);

  const statusColors: Record<string, string> = {
    draft: "bg-status-yellow",
    scheduled: "bg-status-green",
    posted: "bg-primary-500",
    dismissed: "bg-text-muted",
  };

  const approvedBriefs = briefs.filter((b) => b.status === "approved");
  const draftBriefs = briefs.filter((b) => b.status === "draft");
  const suggestions = [...approvedBriefs, ...draftBriefs].slice(0, 10);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Content Engine</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Briefs waiting, the week&apos;s calendar, and one-click scheduling.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/brand-voice"
            className="inline-flex items-center gap-1.5 px-3 md:px-4 py-2 border border-border rounded-lg text-xs md:text-sm text-foreground hover:bg-card-hover transition-colors duration-150"
          >
            <Sparkles size={14} />
            Brand voice
          </Link>
          <Link
            href="/content-briefs"
            className="px-4 py-2 bg-primary-500 text-white text-sm font-medium rounded-lg hover:bg-primary-600 transition-colors"
          >
            Go to briefs
          </Link>
        </div>
      </div>

      {/* Content Calendar */}
      <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">
          This week
        </h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 sm:gap-2">
          {calendar.map((day) => (
            <div key={day.date} className="text-center">
              <p className="text-text-muted text-xs mb-1">{day.dayLabel}</p>
              <div className={`rounded-lg p-3 min-h-[80px] ${day.posts.length > 0 ? "bg-background border border-border/50" : "bg-background/50"}`}>
                <p className="text-text-secondary text-xs mb-2">{day.date.split(" ")[1]}</p>
                {day.posts.length === 0 ? (
                  <p className="text-text-muted text-[10px]">—</p>
                ) : (
                  <div className="space-y-1">
                    {day.posts.map((post) => (
                      <div key={post.id} className="flex items-center gap-1.5 justify-center">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusColors[post.status] ?? "bg-text-muted"}`} />
                        <span className="text-text-secondary text-[10px] capitalize">{post.platform}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-status-yellow" /><span className="text-text-muted text-xs">Draft</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-status-green" /><span className="text-text-muted text-xs">Scheduled</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary-500" /><span className="text-text-muted text-xs">Posted</span></div>
        </div>
      </div>

      {/* Brief suggestions */}
      <div className="bg-card rounded-xl p-6 border border-border/50">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
            Briefs ready to schedule
          </h2>
          <Link href="/content-briefs" className="text-xs text-primary-500 hover:underline">
            Manage all briefs
          </Link>
        </div>

        {suggestions.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-foreground font-semibold mb-1">No briefs yet</p>
            <p className="text-text-muted text-sm max-w-[480px] mx-auto">
              Briefs come from intel cards or manual creation. Head to{" "}
              <Link href="/intel-feed" className="text-primary-500 hover:underline">
                Intel Feed
              </Link>{" "}
              to generate ideas from competitor activity.
            </p>
          </div>
        ) : (
          <AIContentClient tenantSlug={tenantSlug} briefs={suggestions} />
        )}
      </div>

      {/* Metrics */}
      {suggestions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <div className="bg-card rounded-xl p-4 border border-border/50">
            <p className="text-text-secondary text-xs">Briefs waiting</p>
            <p className="text-2xl font-bold text-foreground mt-1">{approvedBriefs.length}</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border/50">
            <p className="text-text-secondary text-xs">Posts this week</p>
            <p className="text-2xl font-bold text-status-green mt-1">
              {scheduled.filter((s) => s.status === "scheduled").length}
            </p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border/50">
            <p className="text-text-secondary text-xs">Posted</p>
            <p className="text-2xl font-bold text-primary-500 mt-1">
              {scheduled.filter((s) => s.status === "posted").length}
            </p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border/50">
            <p className="text-text-secondary text-xs">Drafts</p>
            <p className="text-2xl font-bold text-status-yellow mt-1">{draftBriefs.length}</p>
          </div>
        </div>
      )}
    </div>
  );
}
