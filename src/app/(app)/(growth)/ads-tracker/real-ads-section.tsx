// Real ads platform section — only rendered once at least one Meta/TikTok
// ad account is connected (see page.tsx). Shows blended ROAS (spend joined
// against real orders, not the platform's self-reported number), the
// synced campaign list, active alerts, and budget guardrail rules.

import Link from "next/link";
import { Radar } from "lucide-react";
import { listAdAccountsForTenant } from "@/lib/services/ad-accounts";
import { getAdCampaignRoas, getAdRoasSummary } from "@/lib/attribution/ads";
import { listAdAlerts } from "@/lib/services/ad-alerts";
import { listAdBudgetRules } from "@/lib/services/ad-budget-rules";
import { listCompetitorAds } from "@/lib/services/competitor-ads";
import { isMetaAdLibraryConfigured } from "@/lib/integrations/meta-ad-library";
import { formatCurrency } from "@/lib/utils/format";
import { FeatureSetupNotice } from "@/components/ui/FeatureSetupNotice";
import { BudgetRulesPanel } from "./budget-rules-panel";
import { UtmMappingButton } from "./utm-mapping-button";

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", tiktok: "TikTok" };

function daysRunning(firstSeenAtIso: string): number {
  const elapsedMs = Date.now() - new Date(firstSeenAtIso).getTime();
  return Math.max(1, Math.round(elapsedMs / (24 * 60 * 60 * 1000)));
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "primary" | "red" }) {
  const valueColor =
    tone === "green" ? "text-status-green" : tone === "primary" ? "text-primary-500" : tone === "red" ? "text-status-red" : "text-foreground";
  return (
    <div className="rounded-xl p-3 border border-border/50 bg-sidebar/30">
      <p className="text-text-secondary text-[11px] uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${valueColor}`}>{value}</p>
    </div>
  );
}

export async function RealAdsSection({ tenantSlug }: { tenantSlug: string }) {
  const [accounts, summary, campaigns, alerts, rules, competitorAds] = await Promise.all([
    listAdAccountsForTenant(tenantSlug),
    getAdRoasSummary(tenantSlug, 30),
    getAdCampaignRoas(tenantSlug, 30),
    listAdAlerts(tenantSlug, { unresolvedOnly: true, limit: 10 }),
    listAdBudgetRules(tenantSlug),
    listCompetitorAds(tenantSlug, { activeOnly: true, limit: 8 }),
  ]);

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-2xl border border-border/50 p-5">
        <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Real ad accounts</h2>
            <p className="text-xs text-text-muted mt-1">
              {accounts.map((a) => `${PLATFORM_LABEL[a.platform]} (${a.accountName ?? a.externalAccountId})`).join(" · ")} · last 30 days
            </p>
          </div>
          <Link href="/settings/integrations" className="text-xs text-primary-500 hover:underline">
            Manage connections →
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MiniStat label="Ad spend" value={formatCurrency(summary.totalSpend, summary.currency)} />
          <MiniStat label="Attributed revenue" value={formatCurrency(summary.totalAttributedRevenue, summary.currency)} tone="green" />
          <MiniStat label="Blended ROAS" value={summary.blendedRoas != null ? `${summary.blendedRoas}x` : "—"} tone="primary" />
          <MiniStat label="Platform-reported ROAS" value={summary.platformRoas != null ? `${summary.platformRoas}x` : "—"} />
        </div>
        {summary.campaignsUnmatched > 0 && (
          <p className="text-xs text-status-yellow mb-4">
            {summary.campaignsUnmatched} campaign{summary.campaignsUnmatched === 1 ? "" : "s"} not matched to real order data yet — blended
            ROAS for those is unavailable until their UTM mapping is confirmed below.
          </p>
        )}

        {campaigns.length === 0 ? (
          <p className="text-sm text-text-muted">No campaigns synced yet — the daily structure sync will populate this shortly after connecting.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 md:mx-0">
            <div className="rounded-xl border border-border/50 overflow-hidden min-w-[820px] md:min-w-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50 bg-sidebar/40">
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Campaign</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Platform</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Spend</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-500">Blended ROAS</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Platform ROAS</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={`${c.adAccountId}-${c.campaignExternalId}`} className="border-b border-border/30 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-3 text-sm text-foreground font-medium">{c.campaignName}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{PLATFORM_LABEL[c.platform]}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{formatCurrency(c.spend, c.currency)}</td>
                      <td className="px-4 py-3 text-right">
                        {c.blendedRoas != null ? (
                          <span className={`text-sm font-bold ${c.blendedRoas >= 3 ? "text-status-green" : c.blendedRoas >= 1 ? "text-status-yellow" : "text-status-red"}`}>
                            {c.blendedRoas.toFixed(1)}x
                          </span>
                        ) : (
                          <span className="text-text-muted text-sm">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-text-muted">{c.platformReportedRoas != null ? `${c.platformReportedRoas.toFixed(1)}x` : "—"}</td>
                      <td className="px-4 py-3">
                        <UtmMappingButton
                          adAccountId={c.adAccountId}
                          campaignExternalId={c.campaignExternalId}
                          confidence={c.matchConfidence}
                          matchedUtm={c.matchedUtmCampaign}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {alerts.length > 0 && (
        <section className="bg-card rounded-2xl border border-border/50 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Alerts</h2>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg border border-border/50 p-3">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    a.severity === "high" ? "bg-status-red/10 text-status-red" : a.severity === "medium" ? "bg-status-yellow/10 text-status-yellow" : "bg-sidebar text-text-muted"
                  }`}
                >
                  {a.alertType.replace(/_/g, " ")}
                </span>
                <p className="text-sm text-foreground">{a.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {competitorAds.length > 0 ? (
        <section className="bg-card rounded-2xl border border-border/50 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Competitor ads still running</h2>
          <p className="text-xs text-text-muted mb-3">
            Longest-running first — an ad still active after weeks is evidence it&apos;s working. Exact spend isn&apos;t available for ordinary
            commercial ads (Meta only exposes that for political/EU-regulated ads); longevity and how many variants a competitor is running are
            the real signal here.
          </p>
          <div className="space-y-2">
            {competitorAds.map((ad) => {
              const days = daysRunning(ad.firstSeenAt);
              return (
                <div key={ad.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ad.pageOrAccountName ?? "Unknown page"}</p>
                    <p className="text-xs text-text-muted truncate">{ad.creativeBody ?? "No creative text captured"}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-status-green font-medium">{days}d running</span>
                    {ad.snapshotUrl && (
                      <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="text-xs text-primary-500 hover:underline">
                        View ad →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : !isMetaAdLibraryConfigured() ? (
        <FeatureSetupNotice
          icon={Radar}
          title="Competitor ad intelligence isn't set up yet"
          description="Needs a Meta Ad Library access token to pull public ad data for your competitors. Even once configured, exact spend and impression numbers are only available for political or EU-regulated ads — for an ordinary commercial competitor you'll still get real creative, longevity, and platform data, just not a spend figure."
          steps={[
            "Get a Meta Ad Library API access token (a verified developer account is enough — no Business Verification or App Review needed, unlike the full Marketing API)",
            "Add META_AD_LIBRARY_ACCESS_TOKEN to your deployment environment and redeploy",
            "The sync-competitor-ads cron picks up creative, longevity, and platform data on its next run",
          ]}
        />
      ) : null}

      <BudgetRulesPanel tenantSlug={tenantSlug} accounts={accounts} initialRules={rules} />
    </div>
  );
}
