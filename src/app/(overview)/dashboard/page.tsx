import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowUpRight, Bell } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { PlatformBreakdown } from "@/components/dashboard/PlatformBreakdown";
import { PulseSuggestions } from "@/components/dashboard/PulseSuggestions";
import { getDashboardStats, getPlatforms, getSuggestions } from "@/lib/services/dashboard";
import { getTenant } from "@/lib/services/tenants";
import { formatCurrency } from "@/lib/utils/format";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [tenant, stats, platforms, suggestions] = await Promise.all([
    getTenant(tenantSlug),
    getDashboardStats(tenantSlug),
    getPlatforms(tenantSlug),
    getSuggestions(tenantSlug),
  ]);

  if (!tenant || !stats) {
    return (
      <div className="p-8">
        <p className="text-text-secondary">Tenant not found.</p>
      </div>
    );
  }

  // Format ad spend with tenant currency
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
    <div className="p-8 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Week of {weekLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell tenantSlug={tenantSlug} />
          <Link href="/weekly-report" className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-white hover:bg-card-hover transition-colors duration-150 active:scale-[0.98]">
            Weekly report
            <ArrowUpRight size={14} />
          </Link>
          <button className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-white hover:bg-card-hover transition-colors duration-150 active:scale-[0.98]">
            Ask Pulse
            <ArrowUpRight size={14} />
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard data={stats.socialReach} />
        <StatCard data={stats.profileScore} scoreMax={100} />
        <StatCard data={stats.activeLeads} />
        <StatCard data={adSpendFormatted} />
      </div>

      {/* Two-column bottom */}
      <div className="grid grid-cols-2 gap-4">
        <PlatformBreakdown platforms={platforms} />
        <PulseSuggestions suggestions={suggestions} />
      </div>
    </div>
  );
}
