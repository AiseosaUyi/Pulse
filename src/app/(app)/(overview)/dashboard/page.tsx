import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { PlatformBreakdown } from "@/components/dashboard/PlatformBreakdown";
import { PulseSuggestions } from "@/components/dashboard/PulseSuggestions";
import { CoachFeed } from "@/components/coach/CoachFeed";
import { WeeklyReviewBanner } from "@/components/dashboard/WeeklyReviewBanner";
import { getDashboardStats, getPlatforms, getSuggestions } from "@/lib/services/dashboard";
import { getNotifications } from "@/lib/services/notifications";
import { getTenant } from "@/lib/services/tenants";
import { listActiveCoachActions } from "@/lib/services/coach";
import { getLatestWeeklyReview } from "@/lib/services/weekly-reviews";
import { getSetupStatus } from "@/lib/services/setup-status";
import { SetupBanner } from "@/components/dashboard/SetupBanner";
import { formatCurrency } from "@/lib/utils/format";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [tenant, stats, platforms, suggestions, notifications, coachActions, weeklyReview, setupStatus] = await Promise.all([
    getTenant(tenantSlug),
    getDashboardStats(tenantSlug),
    getPlatforms(tenantSlug),
    getSuggestions(tenantSlug),
    getNotifications(tenantSlug),
    listActiveCoachActions(tenantSlug, 8),
    getLatestWeeklyReview(tenantSlug),
    getSetupStatus(tenantSlug),
  ]);

  if (!tenant || !stats) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-text-secondary">Tenant not found.</p>
      </div>
    );
  }

  const adSpendFormatted = {
    ...stats.adSpend,
    value:
      stats.adSpend.value === "0"
        ? formatCurrency(0, tenant.currency)
        : formatCurrency(Number(stats.adSpend.value), tenant.currency),
  };

  const now = new Date();
  const weekLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Week of {weekLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationBell notifications={notifications} />
          <Link href="/weekly-report" className="flex items-center gap-2 px-3 md:px-4 py-2 border border-border rounded-lg text-xs md:text-sm text-foreground hover:bg-card-hover transition-colors duration-150 active:scale-[0.98] touch-manipulation">
            Weekly report
            <ArrowUpRight size={14} />
          </Link>
          <button className="flex items-center gap-2 px-3 md:px-4 py-2 border border-border rounded-lg text-xs md:text-sm text-foreground hover:bg-card-hover transition-colors duration-150 active:scale-[0.98] touch-manipulation">
            Ask Pulse
            <ArrowUpRight size={14} />
          </button>
        </div>
      </div>

      {/* Launch readiness — stays until every setup task is done */}
      <SetupBanner status={setupStatus} />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard data={stats.socialReach} />
        <StatCard data={stats.profileScore} scoreMax={100} />
        <StatCard data={stats.activeLeads} />
        <StatCard data={adSpendFormatted} />
      </div>

      {/* Weekly business review — synthesis of what Pulse shipped this week */}
      <div className="mb-4">
        <WeeklyReviewBanner
          tenantSlug={tenantSlug}
          initial={weeklyReview}
        />
      </div>

      {/* AI Coach — priority actions queue */}
      <div className="mb-4">
        <CoachFeed tenantSlug={tenantSlug} initial={coachActions} />
      </div>

      {/* Two-column bottom */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PlatformBreakdown platforms={platforms} />
        <PulseSuggestions suggestions={suggestions} />
      </div>
    </div>
  );
}
