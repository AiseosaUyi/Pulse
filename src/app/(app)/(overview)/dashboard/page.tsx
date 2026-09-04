import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { PlatformBreakdown } from "@/components/dashboard/PlatformBreakdown";
import { PulseSuggestions } from "@/components/dashboard/PulseSuggestions";
import { WeeklyReviewBanner } from "@/components/dashboard/WeeklyReviewBanner";
import { NeedsYouBanner } from "@/components/needs-you/NeedsYouBanner";
import { ActionQueueBoard } from "@/components/action-queue/ActionQueueBoard";
import { getDashboardStats, getPlatforms, getSuggestions } from "@/lib/services/dashboard";
import { getSetupStatus } from "@/lib/services/setup-status";
import { getNotifications } from "@/lib/services/notifications";
import { getTenant } from "@/lib/services/tenants";
import { getLatestWeeklyReview } from "@/lib/services/weekly-reviews";
import { listActionQueue, type QueueGroupKey } from "@/lib/services/action-queue";
import { CadenceRail } from "@/app/(app)/(social)/composer/CadenceRail";
import { getTracker } from "@/lib/services/cadence";
import { formatCurrency } from "@/lib/utils/format";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SUPPORT_VISIBLE_GROUPS: QueueGroupKey[] = ["needs_reply", "follow_ups_due", "going_cold"];

function queueSummary(groups: Awaited<ReturnType<typeof listActionQueue>>["groups"]): string {
  const reply = groups.find((g) => g.key === "needs_reply");
  // The service groups chores in with decisions/escalations (§0.7 of the
  // build plan); the board splits them into a separate collapsed "Chores"
  // section, so the header count has to match what the decision PANE
  // actually shows, not the raw service group — otherwise "16 need a
  // decision" points at a pane that only has 3 cards in it.
  const decisionCount = (groups.find((g) => g.key === "needs_decision")?.rows ?? []).filter(
    (r) => r.kind !== "chore"
  ).length;
  const parts: string[] = [];
  if (reply && reply.count > 0) parts.push(`${reply.count} need${reply.count === 1 ? "s" : ""} a reply`);
  if (decisionCount > 0) parts.push(`${decisionCount} decision${decisionCount === 1 ? "" : "s"}`);

  const oldest = reply?.rows[0]?.receivedAt;
  if (oldest) {
    const days = Math.floor((Date.now() - new Date(oldest).getTime()) / (24 * 60 * 60 * 1000));
    if (days >= 1) parts.push(`oldest waiting ${days} day${days === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "All caught up";
}

export default async function DashboardPage() {
  const currentTenant = await getCurrentTenant();
  const tenantSlug = currentTenant?.slug ?? "";
  const accountType = currentTenant?.accountType ?? "startup";
  const role = currentTenant?.role ?? "member";
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [tenant, stats, notifications, setupStatus, queueResult] = await Promise.all([
    getTenant(tenantSlug),
    getDashboardStats(tenantSlug),
    getNotifications(tenantSlug),
    getSetupStatus(tenantSlug, accountType),
    listActionQueue(supabase, tenantSlug, { currentUserId: user?.id }),
  ]);

  if (!tenant || !stats || !user) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-text-secondary">Tenant not found.</p>
      </div>
    );
  }

  // Queue activity log (who opened/copied/resolved what, and when) is
  // owner/admin-only — same bar as inviting teammates. queue_activity_log's
  // RLS enforces this independently; this just decides whether to render
  // the affordance at all.
  const canSeeActivity = role === "owner" || role === "admin";

  // Role-aware rendering only — a presentation choice, not the security
  // boundary. The real fence is RLS: migration 105's action_items policy
  // already restricts a support member to kind IN (reply, follow_up) rows
  // even under a direct Supabase call; this just keeps the rest of the
  // page (ad spend, prospect counts, weekly review) off their screen too.
  if (role === "support") {
    return (
      <div className="p-4 md:p-8 max-w-[1200px]">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-text-secondary text-sm mt-0.5">{queueSummary(queueResult.groups)}</p>
          </div>
          <NotificationBell notifications={notifications} />
        </div>
        <ActionQueueBoard
          initial={queueResult}
          canSeeActivity={canSeeActivity}
          visibleGroups={SUPPORT_VISIBLE_GROUPS}
        />
      </div>
    );
  }

  const [platforms, suggestions, weeklyReview, tracker] = await Promise.all([
    getPlatforms(tenantSlug),
    getSuggestions(tenantSlug),
    getLatestWeeklyReview(tenantSlug),
    getTracker(tenantSlug),
  ]);

  const adSpendFormatted = {
    ...stats.adSpend,
    value:
      stats.adSpend.value === "0"
        ? formatCurrency(0, tenant.currency)
        : formatCurrency(Number(stats.adSpend.value), tenant.currency),
  };

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      {/* Header — live queue state instead of a static week label */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-0.5">{queueSummary(queueResult.groups)}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationBell notifications={notifications} />
          <Link href="/weekly-report" className="flex items-center gap-2 px-3 md:px-4 py-2 border border-border rounded-lg text-xs md:text-sm text-foreground hover:bg-card-hover transition-colors duration-150 active:scale-[0.98] touch-manipulation">
            Weekly report
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      {/* Needs You — computed live per tenant, never authored by hand */}
      <div className="mb-4">
        <NeedsYouBanner status={setupStatus} />
      </div>

      {/* The Action Queue — this is the body of the page. Coach actions
          (formerly a standalone CoachFeed block) are absorbed into it. */}
      <div className="mb-6">
        <ActionQueueBoard initial={queueResult} canSeeActivity={canSeeActivity} />
      </div>

      {/* The numbers, compressed below the queue — context, not the job */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4">
        <StatCard data={stats.socialReach} />
        <StatCard data={stats.profileScore} scoreMax={100} />
        {accountType === "individual" ? (
          <>
            <StatCard data={stats.postsThisWeek ?? { label: "Posts this week", value: "0", subtitle: "Schedule via Composer" }} />
            <StatCard data={stats.avgEngagement ?? { label: "Avg. engagement", value: "—", subtitle: "Connect platforms to see" }} />
          </>
        ) : (
          <>
            <StatCard data={stats.activeLeads} />
            <StatCard data={adSpendFormatted} />
          </>
        )}
      </div>

      {tracker && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Today&apos;s schedule</h2>
            <Link href="/today" className="text-xs text-primary-500 hover:underline">
              Full view →
            </Link>
          </div>
          <CadenceRail tracker={tracker} tenantSlug={tenantSlug} />
        </div>
      )}

      {/* This week — collapsed by default; PlatformBreakdown/PulseSuggestions/
          WeeklyReviewBanner also live at /own-analytics and /weekly-report. */}
      <details className="rounded-2xl border border-border bg-card">
        <summary className="cursor-pointer list-none p-5 text-sm font-semibold text-foreground flex items-center justify-between">
          This week
          <span className="text-xs font-normal text-text-muted">Platform breakdown, suggestions, business review</span>
        </summary>
        <div className="px-5 pb-5 space-y-4">
          <WeeklyReviewBanner tenantSlug={tenantSlug} initial={weeklyReview} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PlatformBreakdown platforms={platforms} />
            <PulseSuggestions suggestions={suggestions} />
          </div>
        </div>
      </details>
    </div>
  );
}
