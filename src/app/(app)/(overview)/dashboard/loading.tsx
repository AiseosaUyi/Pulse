import { StatCardSkeleton } from "@/components/dashboard/StatCard";
import { PlatformBreakdownSkeleton } from "@/components/dashboard/PlatformBreakdown";
import { PulseSuggestionsSkeleton } from "@/components/dashboard/PulseSuggestions";

export default function DashboardLoading() {
  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 md:mb-8">
        <div>
          <div className="h-7 w-32 bg-border/50 rounded animate-skeleton mb-2" />
          <div className="h-4 w-40 bg-border/50 rounded animate-skeleton" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-32 bg-border/50 rounded-lg animate-skeleton" />
          <div className="h-10 w-28 bg-border/50 rounded-lg animate-skeleton" />
        </div>
      </div>

      {/* Action Queue skeleton — the body of the page */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="h-5 w-28 bg-border/50 rounded animate-skeleton" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-border/30 animate-skeleton" />
        ))}
      </div>

      {/* Stat card skeletons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Two-column skeletons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PlatformBreakdownSkeleton />
        <PulseSuggestionsSkeleton />
      </div>
    </div>
  );
}
