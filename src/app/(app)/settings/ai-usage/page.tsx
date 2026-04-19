import { cookies } from "next/headers";
import Link from "next/link";
import { Zap } from "lucide-react";
import {
  getAiUsageSummary,
  getRecentAiCalls,
} from "@/lib/services/ai-usage";

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function AiUsagePage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [summary, recent] = await Promise.all([
    getAiUsageSummary(tenantSlug),
    getRecentAiCalls(tenantSlug, 20),
  ]);

  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="max-w-[760px] space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Zap size={16} className="text-text-muted" />
          <h1
            className="text-xl md:text-2xl text-gray-1100 dark:text-foreground tracking-tight"
            style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
          >
            AI usage
          </h1>
        </div>
        <p className="text-sm text-gray-1000 dark:text-text-muted">
          {monthLabel} · calls made through the AI Gateway for this tenant.
        </p>
      </div>

      {summary.totalCalls === 0 ? (
        <section className="bg-card border border-border rounded-2xl p-8 text-center">
          <Zap size={24} className="text-text-muted mx-auto mb-3" />
          <h3 className="text-foreground font-semibold mb-1">
            No AI calls yet this month
          </h3>
          <p className="text-text-muted text-sm max-w-sm mx-auto">
            Every generated brief and weekly digest call will appear here.
            Head to{" "}
            <Link href="/intel-feed" className="text-primary-500 hover:underline">
              Intel Feed
            </Link>{" "}
            and tap &quot;Generate&quot; on a competitor post to make your
            first one.
          </p>
        </section>
      ) : (
        <>
          {/* Stat cards */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total cost"
              value={formatUsd(summary.totalCostUsd)}
              subtitle="this month"
            />
            <StatCard
              label="Calls"
              value={String(summary.totalCalls)}
              subtitle={
                summary.failedCalls > 0
                  ? `${summary.failedCalls} failed`
                  : "all ok"
              }
            />
            <StatCard
              label="Tokens"
              value={formatTokens(
                summary.totalInputTokens + summary.totalOutputTokens
              )}
              subtitle={`${formatTokens(summary.totalInputTokens)} in / ${formatTokens(summary.totalOutputTokens)} out`}
            />
            <StatCard
              label="Cache hit"
              value={`${Math.round(summary.cacheHitRate * 100)}%`}
              subtitle={
                summary.totalCacheReadTokens > 0
                  ? `${formatTokens(summary.totalCacheReadTokens)} cached`
                  : "no cache yet"
              }
            />
          </section>

          {/* Per-model breakdown */}
          {summary.byModel.length > 0 && (
            <section className="bg-card border border-border rounded-2xl p-6">
              <h2
                className="text-xs uppercase tracking-[0.14em] text-gray-500 mb-4"
                style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
              >
                By model
              </h2>
              <ul className="divide-y divide-white-200">
                {summary.byModel.map((m) => (
                  <li
                    key={m.model}
                    className="py-2.5 flex items-center justify-between gap-3"
                  >
                    <span className="text-sm text-foreground font-mono truncate">
                      {m.model}
                    </span>
                    <span className="text-xs text-text-muted shrink-0">
                      {m.calls} call{m.calls !== 1 ? "s" : ""} · {formatUsd(m.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recent calls */}
          <section className="bg-card border border-border rounded-2xl p-6">
            <h2
              className="text-xs uppercase tracking-[0.14em] text-gray-500 mb-4"
              style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
            >
              Recent calls
            </h2>
            <ul className="divide-y divide-white-200">
              {recent.map((call) => (
                <li key={call.id} className="py-3 flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      call.success ? "bg-success-500" : "bg-error-500"
                    }`}
                    aria-label={call.success ? "success" : "failed"}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {call.purpose}
                      {!call.success && call.errorMessage && (
                        <span className="text-xs text-text-muted ml-2">
                          · {call.errorMessage.slice(0, 60)}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {call.model}
                      {" · "}
                      {(call.inputTokens ?? 0) + (call.outputTokens ?? 0)} tok
                      {call.cacheReadTokens > 0 &&
                        ` · ${call.cacheReadTokens} cached`}
                      {call.durationMs !== null && ` · ${call.durationMs}ms`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm text-foreground font-mono">
                      {formatUsd(call.costUsd ?? 0)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {timeSince(call.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-text-muted">
            Costs are estimated from token counts and provider published rates.
            Actual billing is on your Vercel AI Gateway dashboard.
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p
        className="text-xl text-foreground tracking-tight"
        style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
      >
        {value}
      </p>
      <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
    </div>
  );
}
