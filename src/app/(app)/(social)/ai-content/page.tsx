import { cookies } from "next/headers";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { listBriefs } from "@/lib/services/briefs";
import {
  listScheduledPosts,
  buildCalendarWeek,
} from "@/lib/services/scheduled-posts";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { AIContentClient } from "./client";
import { ContentBriefsClient } from "@/app/(app)/(intelligence)/content-briefs/client";

type Tab = "calendar" | "briefs";

function normalizeTab(raw: string | string[] | undefined): Tab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "briefs" ? "briefs" : "calendar";
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const { tab: tabParam } = await searchParams;
  const tab = normalizeTab(tabParam);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const [allBriefs, scheduled, voice] = await Promise.all([
    listBriefs(tenantSlug, { includeDismissed: true }),
    listScheduledPosts(tenantSlug, {
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
    }),
    getBrandVoice(tenantSlug),
  ]);

  const calendar = buildCalendarWeek(scheduled, weekStart);

  const statusColors: Record<string, string> = {
    draft: "bg-status-yellow",
    scheduled: "bg-status-green",
    posted: "bg-primary-500",
    dismissed: "bg-text-muted",
  };

  const approvedBriefs = allBriefs.filter((b) => b.status === "approved");
  const draftBriefs = allBriefs.filter((b) => b.status === "draft");
  const suggestions = [...approvedBriefs, ...draftBriefs].slice(0, 10);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Brief ideas grounded in your brand voice. Calendar + one-click
            scheduling on the left, the full brief library on the right.
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
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-5 border-b border-border">
        <TabLink href="/ai-content?tab=calendar" active={tab === "calendar"}>
          Calendar &amp; schedule
        </TabLink>
        <TabLink href="/ai-content?tab=briefs" active={tab === "briefs"}>
          All briefs
          {allBriefs.length > 0 && (
            <span className="ml-1.5 text-[10px] px-1.5 rounded-full bg-sidebar">
              {allBriefs.length}
            </span>
          )}
        </TabLink>
      </div>

      {tab === "calendar" && (
        <>
          {/* Content Calendar */}
          <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">
              This week
            </h2>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 sm:gap-2">
              {calendar.map((day) => (
                <div key={day.date} className="text-center">
                  <p className="text-text-muted text-xs mb-1">{day.dayLabel}</p>
                  <div
                    className={`rounded-lg p-3 min-h-[80px] ${
                      day.posts.length > 0
                        ? "bg-background border border-border/50"
                        : "bg-background/50"
                    }`}
                  >
                    <p className="text-text-secondary text-xs mb-2">
                      {day.date.split(" ")[1]}
                    </p>
                    {day.posts.length === 0 ? (
                      <p className="text-text-muted text-[10px]">—</p>
                    ) : (
                      <div className="space-y-1">
                        {day.posts.map((post) => (
                          <div
                            key={post.id}
                            className="flex items-center gap-1.5 justify-center"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                statusColors[post.status] ?? "bg-text-muted"
                              }`}
                            />
                            <span className="text-text-secondary text-[10px] capitalize">
                              {post.platform}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-status-yellow" />
                <span className="text-text-muted text-xs">Draft</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-status-green" />
                <span className="text-text-muted text-xs">Scheduled</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary-500" />
                <span className="text-text-muted text-xs">Posted</span>
              </div>
            </div>
          </div>

          {/* Brief suggestions */}
          <div className="bg-card rounded-xl p-6 border border-border/50">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Briefs ready to schedule
              </h2>
              <Link
                href="/ai-content?tab=briefs"
                className="text-xs text-primary-500 hover:underline"
              >
                Manage all briefs
              </Link>
            </div>

            {suggestions.length === 0 ? (
              <div className="p-8 max-w-[560px] mx-auto">
                <p className="text-foreground font-semibold mb-2">
                  No briefs ready yet
                </p>
                <p className="text-text-muted text-sm leading-relaxed">
                  Briefs come from your brand audit, from intel cards on the{" "}
                  <Link
                    href="/intel-feed"
                    className="text-primary-500 hover:underline"
                  >
                    Intel Feed
                  </Link>
                  , or from the All Briefs tab (manual create). Re-run the
                  audit from{" "}
                  <Link
                    href="/onboarding/audit"
                    className="text-primary-500 hover:underline"
                  >
                    onboarding
                  </Link>{" "}
                  to regenerate a batch.
                </p>
              </div>
            ) : (
              <AIContentClient tenantSlug={tenantSlug} briefs={suggestions} />
            )}
          </div>

          {/* Metrics */}
          {suggestions.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
              <StatCard label="Briefs waiting" value={approvedBriefs.length} tone="default" />
              <StatCard
                label="Posts this week"
                value={scheduled.filter((s) => s.status === "scheduled").length}
                tone="green"
              />
              <StatCard
                label="Posted"
                value={scheduled.filter((s) => s.status === "posted").length}
                tone="primary"
              />
              <StatCard label="Drafts" value={draftBriefs.length} tone="yellow" />
            </div>
          )}
        </>
      )}

      {tab === "briefs" && (
        <ContentBriefsClient
          briefs={allBriefs}
          tenantSlug={tenantSlug}
          hasVoice={voice !== null}
        />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors inline-flex items-center ${
        active
          ? "border-primary-500 text-foreground"
          : "border-transparent text-text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "green" | "primary" | "yellow";
}) {
  const tones = {
    default: "text-foreground",
    green: "text-status-green",
    primary: "text-primary-500",
    yellow: "text-status-yellow",
  };
  return (
    <div className="bg-card rounded-xl p-4 border border-border/50">
      <p className="text-text-secondary text-xs">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
    </div>
  );
}
