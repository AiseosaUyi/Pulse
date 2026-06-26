import { cookies } from "next/headers";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { listBriefs } from "@/lib/services/briefs";
import { listScheduledPosts } from "@/lib/services/scheduled-posts";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { listForTenant as listContentPlans } from "@/lib/services/content-plans";
import { AIContentClient } from "./client";
import { ContentBriefsClient } from "@/app/(app)/(intelligence)/content-briefs/client";
import { VideoPlansTab } from "./_video-plans-tab";
import { CalendarView } from "./CalendarView";

type Tab = "calendar" | "briefs" | "videos";

function normalizeTab(raw: string | string[] | undefined): Tab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "briefs") return "briefs";
  if (value === "videos") return "videos";
  return "calendar";
}

function getMondayOf(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
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
  const weekStart = getMondayOf(now);
  // Fetch 4-week range: 2 weeks back + 2 weeks ahead for instant client navigation
  const rangeFrom = new Date(weekStart);
  rangeFrom.setDate(rangeFrom.getDate() - 14);
  const rangeTo = new Date(weekStart);
  rangeTo.setDate(rangeTo.getDate() + 21);

  const [allBriefs, scheduled, voice, videoPlans] = await Promise.all([
    listBriefs(tenantSlug, { includeDismissed: true }),
    listScheduledPosts(tenantSlug, {
      from: rangeFrom.toISOString(),
      to: rangeTo.toISOString(),
    }),
    getBrandVoice(tenantSlug),
    listContentPlans(tenantSlug, { limit: 30 }),
  ]);

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
        <TabLink href="/ai-content?tab=videos" active={tab === "videos"}>
          Video plans
          {videoPlans.length > 0 && (
            <span className="ml-1.5 text-[10px] px-1.5 rounded-full bg-sidebar">
              {videoPlans.length}
            </span>
          )}
        </TabLink>
      </div>

      {tab === "calendar" && (
        <>
          <CalendarView
            initialPosts={scheduled}
            initialWeekStart={weekStart.toISOString()}
          />

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
                label="Posts scheduled"
                value={scheduled.filter((s) => s.status === "scheduled").length}
                tone="green"
              />
              <StatCard
                label="Published"
                value={scheduled.filter((s) => s.status === "published").length}
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

      {tab === "videos" && (
        <VideoPlansTab tenantSlug={tenantSlug} initial={videoPlans} />
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
