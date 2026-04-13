import { StatCardSkeleton } from "@/components/dashboard/StatCard";
import { PlatformBreakdownSkeleton } from "@/components/dashboard/PlatformBreakdown";
import { PulseSuggestionsSkeleton } from "@/components/dashboard/PulseSuggestions";

export default function DashboardLoading() {
  return (
    <div className="p-8 max-w-[1200px]">
      {/* Header skeleton */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="h-7 w-32 bg-border/50 rounded animate-skeleton mb-2" />
          <div className="h-4 w-40 bg-border/50 rounded animate-skeleton" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-32 bg-border/50 rounded-lg animate-skeleton" />
          <div className="h-10 w-28 bg-border/50 rounded-lg animate-skeleton" />
        </div>
      </div>

      {/* Stat card skeletons */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Two-column skeletons */}
      <div className="grid grid-cols-2 gap-4">
        <PlatformBreakdownSkeleton />
        <PulseSuggestionsSkeleton />
      </div>
    </div>
  );
}
