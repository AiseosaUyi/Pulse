import { cookies } from "next/headers";
import { getKeywordGroups } from "@/lib/services/seo";
import { KeywordSeedInput } from "@/components/seo/KeywordSeedInput";
import { Badge } from "@/components/ui/Badge";

export default async function KeywordsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const groups = await getKeywordGroups(tenantSlug);

  const totalKeywords = groups.reduce((sum, g) => sum + g.keywords.length, 0);
  const intentCounts = groups.flatMap((g) => g.keywords).reduce((acc, k) => {
    acc[k.intent] = (acc[k.intent] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const trendIcons: Record<string, string> = { rising: "↑", stable: "→", declining: "↓" };
  const trendColors: Record<string, string> = { rising: "text-status-green", stable: "text-text-muted", declining: "text-status-red" };

  return (
    <div>
      <KeywordSeedInput />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Keywords</p>
          <p className="text-2xl font-bold text-white mt-1">{totalKeywords}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Informational</p>
          <p className="text-2xl font-bold text-blue-400 mt-1">{intentCounts.informational || 0}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Transactional</p>
          <p className="text-2xl font-bold text-status-green mt-1">{intentCounts.transactional || 0}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Commercial</p>
          <p className="text-2xl font-bold text-status-yellow mt-1">{intentCounts.commercial || 0}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Navigational</p>
          <p className="text-2xl font-bold text-status-purple mt-1">{intentCounts.navigational || 0}</p>
        </div>
      </div>

      {/* Keyword Groups */}
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.id} className="bg-card rounded-xl border border-border/50 overflow-hidden">
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-white font-semibold">{group.name}</h3>
                <Badge variant={group.dominantIntent as "informational" | "transactional" | "navigational" | "commercial"}>
                  {group.dominantIntent}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>{group.keywords.length} keywords</span>
                <span>Avg. volume: {group.avgVolume.toLocaleString()}</span>
                <span>Avg. difficulty: {group.avgDifficulty}</span>
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Keyword</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Volume</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Difficulty</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">CPC</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Intent</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Trend</th>
                  <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">SERP Features</th>
                </tr>
              </thead>
              <tbody>
                {group.keywords.map((kw) => (
                  <tr key={kw.id} className="border-b border-border/20 last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm">{kw.keyword}</span>
                        {kw.isLongTail && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-purple/10 text-accent-purple">long-tail</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-text-secondary text-right">{kw.volume.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        kw.difficulty === "easy" ? "bg-status-green/10 text-status-green" :
                        kw.difficulty === "medium" ? "bg-status-yellow/10 text-status-yellow" :
                        "bg-status-red/10 text-status-red"
                      }`}>{kw.difficulty}</span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-text-secondary text-right">₦{kw.cpc}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge variant={kw.intent}>{kw.intent.slice(0, 5)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-sm ${trendColors[kw.trend]}`}>{trendIcons[kw.trend]}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex gap-1">
                        {kw.serpFeatures.map((f) => (
                          <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-background text-text-muted">{f.replace("_", " ")}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
