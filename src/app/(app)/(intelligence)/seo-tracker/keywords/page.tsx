import { cookies } from "next/headers";
import { getKeywordRankings, deriveSEOMetrics } from "@/lib/services/seo";
import { KeywordRow } from "@/components/keywords/KeywordRow";
import { AddKeywordButton } from "../client";

export default async function KeywordsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const keywords = await getKeywordRankings(tenantSlug);
  const metrics = deriveSEOMetrics(keywords);

  const totalVolume = keywords.reduce((s, k) => s + k.volume, 0);
  const ranked = keywords.filter((k) => k.position !== null).length;
  const unranked = keywords.length - ranked;

  return (
    <div>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-foreground font-semibold text-lg">Tracked keywords</p>
          <p className="text-text-muted text-xs mt-0.5">
            Add the keywords you actually care about. Delete what you don&apos;t.
            Positions update via the edit button on each row.
          </p>
        </div>
        <AddKeywordButton />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        {metrics.slice(0, 4).map((m) => (
          <div
            key={m.label}
            className="bg-card rounded-xl p-4 border border-border/50"
          >
            <p className="text-text-secondary text-xs">{m.label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-bold text-foreground">{m.value}</span>
              {m.change !== "—" && (
                <span
                  className={`text-xs font-medium ${
                    m.direction === "up"
                      ? "text-status-green"
                      : m.direction === "down"
                      ? "text-status-red"
                      : "text-text-muted"
                  }`}
                >
                  {m.change}
                </span>
              )}
            </div>
          </div>
        ))}
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Unranked</p>
          <p className="text-xl font-bold text-foreground mt-1">{unranked}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Volume</p>
          <p className="text-xl font-bold text-foreground mt-1">
            {totalVolume.toLocaleString()}
          </p>
        </div>
      </div>

      {ranked === 0 && keywords.length > 0 && (
        <div className="mb-4 rounded-lg border border-border/50 bg-sidebar/40 px-4 py-3 text-xs text-text-muted">
          None of your keywords have a position yet. Click the pencil icon on any row to enter where it ranks today.
        </div>
      )}

      {keywords.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <p className="text-foreground font-semibold mb-1">
            No keywords tracked yet
          </p>
          <p className="text-text-muted text-sm">
            Tap &quot;Track Keyword&quot; above to add your first one.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/30 bg-sidebar/40">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Keyword
                  </th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Position
                  </th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Change
                  </th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Difficulty
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Volume
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Last checked
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((kw) => (
                  <KeywordRow key={kw.id} kw={kw} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
