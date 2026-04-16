import { cookies } from "next/headers";
import { mockCampaigns } from "@/lib/data/mock-modules";
import { getTenant } from "@/lib/services/tenants";
import { formatCurrency } from "@/lib/utils/format";
import { Badge } from "@/components/ui/Badge";

export default async function AdsTrackerPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const campaigns = mockCampaigns[tenantSlug] ?? mockCampaigns.gruve;
  const tenant = await getTenant(tenantSlug);
  const currency = tenant?.currency ?? "NGN";

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const totalRevenue = campaigns.reduce((sum, c) => sum + c.revenue, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;
  const overallRoas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(1) : "0";

  const statusBadge: Record<string, { variant: "active" | "overdue" | "opportunity" | "needs_posts"; label: string }> = {
    active: { variant: "active", label: "Active" },
    paused: { variant: "needs_posts", label: "Paused" },
    completed: { variant: "opportunity", label: "Completed" },
    draft: { variant: "overdue", label: "Draft" },
  };

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ads Tracker</h1>
          <p className="text-text-secondary text-sm mt-0.5">Campaign performance and spend tracking</p>
        </div>
        <button className="px-4 py-2 gradient-purple-pink text-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity active:scale-[0.98]">
          New Campaign
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Spend</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalSpend, currency)}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Revenue</p>
          <p className="text-2xl font-bold text-status-green mt-1">{formatCurrency(totalRevenue, currency)}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-accent-purple/30">
          <p className="text-text-secondary text-xs">ROAS (Return on Ad Spend)</p>
          <p className="text-2xl font-bold text-accent-purple mt-1">{overallRoas}x</p>
          <p className="text-text-muted text-[10px] mt-0.5">Every {formatCurrency(1, currency)} spent returns {formatCurrency(Number(overallRoas), currency)}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Conversions</p>
          <p className="text-2xl font-bold text-status-green mt-1">{totalConversions}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Impressions</p>
          <p className="text-xl font-bold text-foreground mt-1">{(totalImpressions / 1000).toFixed(1)}K</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Clicks</p>
          <p className="text-xl font-bold text-foreground mt-1">{totalClicks.toLocaleString()}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Active Campaigns</p>
          <p className="text-xl font-bold text-foreground mt-1">{activeCampaigns}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Avg. Cost/Conversion</p>
          <p className="text-xl font-bold text-foreground mt-1">{totalConversions > 0 ? formatCurrency(Math.round(totalSpend / totalConversions), currency) : "—"}</p>
        </div>
      </div>

      {/* Campaign table */}
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <div className="bg-card rounded-xl border border-border/50 overflow-hidden min-w-[900px] md:min-w-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Campaign</th>
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Platform</th>
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Status</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Spend</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Revenue</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-accent-purple">ROAS</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Conv.</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Cost/Conv.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Period</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-card-hover transition-colors">
                <td className="px-5 py-3.5 text-sm text-foreground font-medium">{c.name}</td>
                <td className="px-5 py-3.5 text-sm text-text-secondary">{c.platform}</td>
                <td className="px-5 py-3.5">
                  <Badge variant={statusBadge[c.status].variant}>{statusBadge[c.status].label}</Badge>
                </td>
                <td className="px-4 py-3.5 text-sm text-foreground text-right">{c.spend > 0 ? formatCurrency(c.spend, currency) : "—"}</td>
                <td className="px-4 py-3.5 text-sm text-status-green text-right">{c.revenue > 0 ? formatCurrency(c.revenue, currency) : "—"}</td>
                <td className="px-4 py-3.5 text-right">
                  {c.roas > 0 ? (
                    <span className={`text-sm font-bold ${c.roas >= 5 ? "text-status-green" : c.roas >= 2 ? "text-status-yellow" : "text-status-red"}`}>{c.roas.toFixed(1)}x</span>
                  ) : <span className="text-text-muted text-sm">—</span>}
                </td>
                <td className="px-4 py-3.5 text-sm text-text-secondary text-right">{c.conversions > 0 ? c.conversions : "—"}</td>
                <td className="px-4 py-3.5 text-sm text-text-secondary text-right">{c.costPerConversion > 0 ? formatCurrency(c.costPerConversion, currency) : "—"}</td>
                <td className="px-4 py-3.5 text-xs text-text-muted">{c.startDate} – {c.endDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
