import { cookies } from "next/headers";
import Link from "next/link";
import { getPlatformScore } from "@/lib/services/platform-score";

export default async function PlatformScorePage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const data = await getPlatformScore(tenantSlug);
  const hasAnyData = data.platforms.some((p) => p.hasData);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Platform Score</h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Cross-platform health scorecard — derived from posts, connection state, and audience size.
        </p>
      </div>

      {!hasAnyData ? (
        <div className="bg-card rounded-2xl border border-border/50 p-10 text-center">
          <p className="text-foreground font-semibold mb-1">No data yet</p>
          <p className="text-text-muted text-sm max-w-[480px] mx-auto">
            Connect your platforms in{" "}
            <Link href="/settings" className="text-primary-500 hover:underline">Settings</Link>{" "}
            and start importing post metrics via{" "}
            <Link href="/own-analytics" className="text-primary-500 hover:underline">Own analytics</Link>.
            Scores compute from posts in the last 30 days, engagement rate, audience size, and connection health.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-secondary text-sm mb-1">Overall Score</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-foreground">{data.overall}</span>
                  <span className="text-xl font-semibold text-text-muted">/100</span>
                </div>
                <p className="text-text-secondary text-sm mt-2">
                  {data.overall >= 70
                    ? "Good momentum — keep posting consistently"
                    : data.overall >= 50
                      ? "Room to improve — focus on your weaker platforms below"
                      : data.overall >= 25
                        ? "Needs attention — several platforms are underperforming"
                        : "Getting started — consistent posting is the fastest lever"}
                </p>
              </div>
              <div className="w-32 h-32 flex items-center justify-center relative">
                <svg className="absolute inset-0" viewBox="0 0 128 128">
                  <circle cx="64" cy="64" r="58" fill="none" stroke="var(--border)" strokeWidth="6" />
                  <circle
                    cx="64" cy="64" r="58" fill="none"
                    stroke="var(--color-primary-500)" strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={`${(data.overall / 100) * 364} 364`}
                    transform="rotate(-90 64 64)"
                  />
                </svg>
                <span className="text-2xl font-bold text-foreground">{data.overall}%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.platforms.map((p) => (
              <div key={p.slug} className="bg-card rounded-xl p-6 border border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-foreground font-semibold">{p.platform}</h3>
                    {!p.connected && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar border border-border text-text-muted">
                        not connected
                      </span>
                    )}
                    {!p.hasData && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar border border-border text-text-muted">
                        no data
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${p.score >= 70 ? "text-status-green" : p.score >= 50 ? "text-status-yellow" : "text-status-red"}`}>
                      {p.score}/100
                    </span>
                    <span className={`text-xs ${p.trend === "up" ? "text-status-green" : p.trend === "down" ? "text-status-red" : "text-text-muted"}`}>
                      {p.trend === "up" ? "↑" : p.trend === "down" ? "↓" : "→"}
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-border/50 rounded-full overflow-hidden mb-4">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${p.score}%` }} />
                </div>
                <div className="space-y-2.5">
                  {p.breakdown.map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-text-secondary text-xs">{item.label}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-border/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${item.score >= 7 ? "bg-status-green" : item.score >= 4 ? "bg-status-yellow" : "bg-status-red"}`}
                            style={{ width: `${(item.score / item.max) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-muted w-8 text-right">{item.score}/{item.max}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
