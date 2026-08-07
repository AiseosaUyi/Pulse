import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getCronHealth, type CronHealthState } from "@/lib/services/system-health";
import { SettingsPageHeading } from "../_shared";
import { isR2Configured } from "@/lib/storage/r2";
import { isQStashConfigured } from "@/lib/qstash";
import { isPerplexityConfigured } from "@/lib/integrations/ai-visibility";
import { isApifyConfigured } from "@/lib/integrations/apify";
import { isScraperApiConfigured } from "@/lib/scrape/scraping-api";
import { isSerperConfigured } from "@/lib/scrape/serper-serp";
import { isMetaAdLibraryConfigured } from "@/lib/integrations/meta-ad-library";
import { isApprovalsConfigured } from "@/lib/approvals/token";
import { isComposioConfigured } from "@/lib/composio/client";
import { isDriveConfigured } from "@/lib/integrations/drive";

export const dynamic = "force-dynamic";

interface IntegrationCheck {
  label: string;
  whatBreaks: string;
  configured: boolean;
}

const STATE_LABEL: Record<CronHealthState, string> = {
  ok: "Healthy",
  stale: "Stale",
  failing: "Failing",
  never_run: "Never run",
};

const STATE_CLASS: Record<CronHealthState, string> = {
  ok: "bg-green-500/10 text-green-600 dark:text-green-400",
  stale: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  failing: "bg-primary-500/10 text-primary-500",
  never_run: "bg-gray-500/10 text-text-muted",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SystemHealthPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return (
      <div>
        <SettingsPageHeading
          icon={Activity}
          title="System health"
          subtitle="Owners and admins only."
        />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Cron and pipeline health is visible to workspace owners and admins.
          </p>
        </div>
      </div>
    );
  }

  const jobs = await getCronHealth();
  const issues = jobs.filter((j) => j.state !== "ok").length;

  const integrations: IntegrationCheck[] = [
    {
      label: "Cloudflare R2 storage",
      whatBreaks:
        "Video renders, content-vault uploads, and blog images can't be saved",
      configured: isR2Configured(),
    },
    {
      label: "QStash scheduling",
      whatBreaks: "Scheduled posts never actually publish at their scheduled time",
      configured: isQStashConfigured(),
    },
    {
      label: "Perplexity (AI-search visibility)",
      whatBreaks: "AI-search citation tracking (GEO/AEO) can't run",
      configured: isPerplexityConfigured(),
    },
    {
      label: "Apify (TikTok/Instagram scraping)",
      whatBreaks:
        "Trend scouting and X-listening sync for those platforms silently no-op",
      configured: isApifyConfigured(),
    },
    {
      label: "ScraperAPI",
      whatBreaks: "SERP/rank-check fallback scraping is unavailable",
      configured: isScraperApiConfigured(),
    },
    {
      label: "Serper (SERP API)",
      whatBreaks: "Keyword rank checks and SEO research silently fail",
      configured: isSerperConfigured(),
    },
    {
      label: "Meta Ad Library",
      whatBreaks: "Competitor ad intelligence sync never runs",
      configured: isMetaAdLibraryConfigured(),
    },
    {
      label: "Approval briefings",
      whatBreaks:
        "Mobile/email approval-request links can't be generated or verified",
      configured: isApprovalsConfigured(),
    },
    {
      label: "Composio",
      whatBreaks:
        "The parallel publish/engagement/insights sync path for Instagram/LinkedIn/TikTok is unavailable (falls back to SocialAPI.ai where possible)",
      configured: isComposioConfigured(),
    },
    {
      label: "Google Drive OAuth",
      whatBreaks: "Content Pipeline's Drive-backed media library can't connect",
      configured: isDriveConfigured(),
    },
  ];
  const missingIntegrations = integrations.filter((i) => !i.configured).length;

  return (
    <div className="max-w-[820px]">
      <SettingsPageHeading
        icon={Activity}
        title="System health"
        subtitle="Background jobs that keep Pulse's data fresh. A job is flagged stale when it hasn't run within twice its expected interval, or failing after a run errors. Reload to refresh."
      />

      <div
        className={`mb-4 rounded-xl px-4 py-3 text-sm ${
          issues === 0
            ? "bg-green-500/10 text-green-600 dark:text-green-400"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        }`}
      >
        {issues === 0
          ? "All scheduled jobs are healthy."
          : `${issues} job${issues === 1 ? "" : "s"} need attention.`}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-4 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last run</th>
              <th className="px-4 py-3 font-medium text-right">Rows</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.jobName}
                className="border-b border-border/50 last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">
                    {job.jobName}
                  </div>
                  {job.lastError && (
                    <div className="text-xs text-primary-500 mt-0.5 truncate max-w-[320px]">
                      {job.lastError}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATE_CLASS[job.state]
                    }`}
                  >
                    {STATE_LABEL[job.state]}
                  </span>
                  {job.consecutiveFailures > 1 && (
                    <span className="ml-2 text-xs text-text-muted">
                      ×{job.consecutiveFailures}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {fmt(job.lastStartedAt)}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {job.rowsProcessed ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted mt-3">
        Email alerts fire after a job fails {3} runs in a row when{" "}
        <code>CRON_ALERT_EMAIL</code> is configured.
      </p>

      <div className="mt-8">
        <SettingsPageHeading
          icon={Activity}
          title="Integration status"
          subtitle="App-level integrations configured via environment variables. These are fixable by a developer/deployer only — not from tenant settings — and currently fail silently with no UI indication anywhere else in the app when unset."
        />
      </div>

      <div
        className={`mb-4 rounded-xl px-4 py-3 text-sm ${
          missingIntegrations === 0
            ? "bg-green-500/10 text-green-600 dark:text-green-400"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        }`}
      >
        {missingIntegrations === 0
          ? "All environment integrations are configured."
          : `${missingIntegrations} integration${missingIntegrations === 1 ? "" : "s"} not configured.`}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-4 py-3 font-medium">Integration</th>
              <th className="px-4 py-3 font-medium">What breaks without it</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {integrations.map((integration) => (
              <tr
                key={integration.label}
                className="border-b border-border/50 last:border-0"
              >
                <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                  {integration.label}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {integration.whatBreaks}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                      integration.configured
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {integration.configured ? "Configured" : "Not configured"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
