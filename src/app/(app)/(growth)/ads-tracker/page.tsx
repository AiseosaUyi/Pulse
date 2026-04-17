import { Badge } from "@/components/ui/Badge";
import { getCurrentTenant } from "@/lib/auth";
import { getCampaigns, summarize } from "@/lib/services/campaigns";
import { getTenant } from "@/lib/services/tenants";
import {
  CAMPAIGN_PLATFORM_LABELS,
  CAMPAIGN_STATUS_LABELS,
  type CampaignStatus,
} from "@/lib/types/campaigns";
import { formatCurrency } from "@/lib/utils/format";
import { AddCampaignButton } from "./client";

const statusBadge: Record<CampaignStatus, { variant: "active" | "overdue" | "opportunity" | "needs_posts" }> = {
  active: { variant: "active" },
  paused: { variant: "needs_posts" },
  completed: { variant: "opportunity" },
  draft: { variant: "overdue" },
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const [, y, m, d] = match;
  return dateFormatter.format(new Date(Number(y), Number(m) - 1, Number(d)));
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export default async function AdsTrackerPage() {
  const tenant = await getCurrentTenant();
  const campaigns = tenant ? await getCampaigns(tenant.slug) : [];
  const summary = summarize(campaigns);
  const tenantMeta = tenant ? await getTenant(tenant.slug) : null;
  const currency = tenantMeta?.currency ?? "NGN";

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ads Tracker</h1>
          <p className="text-text-secondary text-sm mt-0.5">Campaign performance and spend tracking</p>
        </div>
        <AddCampaignButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Spend</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(summary.totalSpend, currency)}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Revenue</p>
          <p className="text-2xl font-bold text-status-green mt-1">{formatCurrency(summary.totalRevenue, currency)}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-primary-500/30">
          <p className="text-text-secondary text-xs">ROAS (Return on Ad Spend)</p>
          <p className="text-2xl font-bold text-primary-500 mt-1">{summary.overallRoas}x</p>
          <p className="text-text-muted text-[10px] mt-0.5">
            Every {formatCurrency(1, currency)} spent returns {formatCurrency(summary.overallRoas, currency)}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Conversions</p>
          <p className="text-2xl font-bold text-status-green mt-1">{summary.totalConversions}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Impressions</p>
          <p className="text-xl font-bold text-foreground mt-1">
            {summary.totalImpressions >= 1000
              ? `${(summary.totalImpressions / 1000).toFixed(1)}K`
              : summary.totalImpressions.toString()}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Clicks</p>
          <p className="text-xl font-bold text-foreground mt-1">{summary.totalClicks.toLocaleString()}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Active Campaigns</p>
          <p className="text-xl font-bold text-foreground mt-1">{summary.active}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Avg. Cost/Conversion</p>
          <p className="text-xl font-bold text-foreground mt-1">
            {summary.avgCostPerConversion > 0 ? formatCurrency(summary.avgCostPerConversion, currency) : "—"}
          </p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-card rounded-xl border border-border/50 p-10 text-center">
          <p className="text-sm text-foreground font-medium">No campaigns yet</p>
          <p className="text-text-secondary text-xs mt-1">
            Click &ldquo;New Campaign&rdquo; to start tracking ad spend and performance.
          </p>
        </div>
      ) : (
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
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-500">ROAS</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Conv.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Cost/Conv.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Period</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-5 py-3.5 text-sm text-foreground font-medium">{c.name}</td>
                    <td className="px-5 py-3.5 text-sm text-text-secondary">{CAMPAIGN_PLATFORM_LABELS[c.platform]}</td>
                    <td className="px-5 py-3.5">
                      <Badge variant={statusBadge[c.status].variant}>
                        {CAMPAIGN_STATUS_LABELS[c.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-foreground text-right">
                      {c.spend > 0 ? formatCurrency(c.spend, currency) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-status-green text-right">
                      {c.revenue > 0 ? formatCurrency(c.revenue, currency) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {c.roas > 0 ? (
                        <span
                          className={`text-sm font-bold ${
                            c.roas >= 5
                              ? "text-status-green"
                              : c.roas >= 2
                                ? "text-status-yellow"
                                : "text-status-red"
                          }`}
                        >
                          {c.roas.toFixed(1)}x
                        </span>
                      ) : (
                        <span className="text-text-muted text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-text-secondary text-right">
                      {c.conversions > 0 ? c.conversions : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-text-secondary text-right">
                      {c.costPerConversion > 0 ? formatCurrency(c.costPerConversion, currency) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-text-muted">{formatPeriod(c.startDate, c.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
