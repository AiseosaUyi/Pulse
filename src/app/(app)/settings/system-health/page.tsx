import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getCronHealth, type CronHealthState } from "@/lib/services/system-health";
import { SettingsPageHeading } from "../_shared";

export const dynamic = "force-dynamic";

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
    </div>
  );
}
