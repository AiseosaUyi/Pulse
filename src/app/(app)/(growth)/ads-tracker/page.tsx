// Ads Critic + manual campaign tracker. The AI Creative Critic is
// the primary feature — it's the one thing we can ship on an ads
// tab that actually reduces cost without piping in Meta/TikTok data.
// The old campaign table is kept below as a compressed side-panel
// for operators who still log spend by hand.

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
import { AdCritiquePanel } from "./ad-critique";

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
    <div className="p-4 md:p-8 max-w-[1200px] space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ads Critic</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Paste a running Meta or TikTok ad. Get a ruthless critique that
            tells you whether to ship, polish, or kill — plus a rewrite.
          </p>
        </div>
      </div>

      {tenant && <AdCritiquePanel tenantSlug={tenant.slug} />}

      {/* Manual campaign tracker — secondary. Kept for operators who
          log spend by hand. If you pipe in Meta/TikTok reports later,
          this becomes the auto-populated overview. */}
      <section className="bg-card rounded-2xl border border-border/50 p-5">
        <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              Manual campaign tracker
            </h2>
            <p className="text-xs text-text-muted mt-1">
              Log spend + revenue by hand while we wait on Meta / TikTok data
              connectors.
            </p>
          </div>
          <AddCampaignButton />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MiniStat
            label="Total spend"
            value={formatCurrency(summary.totalSpend, currency)}
          />
          <MiniStat
            label="Total revenue"
            value={formatCurrency(summary.totalRevenue, currency)}
            tone="green"
          />
          <MiniStat
            label="ROAS"
            value={`${summary.overallRoas}x`}
            tone="primary"
          />
          <MiniStat
            label="Conversions"
            value={summary.totalConversions.toString()}
            tone="green"
          />
        </div>

        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-foreground font-medium">No campaigns logged yet</p>
            <p className="text-text-secondary text-xs mt-1">
              Use &ldquo;New campaign&rdquo; if you want to track spend by hand.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 md:mx-0">
            <div className="rounded-xl border border-border/50 overflow-hidden min-w-[720px] md:min-w-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50 bg-sidebar/40">
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Campaign</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Platform</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Status</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Spend</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-500">ROAS</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Period</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-3 text-sm text-foreground font-medium">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{CAMPAIGN_PLATFORM_LABELS[c.platform]}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadge[c.status].variant}>
                          {CAMPAIGN_STATUS_LABELS[c.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">
                        {c.spend > 0 ? formatCurrency(c.spend, currency) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
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
                      <td className="px-4 py-3 text-xs text-text-muted">{formatPeriod(c.startDate, c.endDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "primary";
}) {
  const valueColor =
    tone === "green"
      ? "text-status-green"
      : tone === "primary"
        ? "text-primary-500"
        : "text-foreground";
  return (
    <div className="rounded-xl p-3 border border-border/50 bg-sidebar/30">
      <p className="text-text-secondary text-[11px] uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${valueColor}`}>{value}</p>
    </div>
  );
}
