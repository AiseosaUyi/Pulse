import { cookies } from "next/headers";
import { getTopicalClusters } from "@/lib/services/seo";
import { ContentScoreRing } from "@/components/seo/ContentScoreRing";
import { Badge } from "@/components/ui/Badge";

export default async function TopicalMapPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const clusters = await getTopicalClusters(tenantSlug);

  const totalArticles = clusters.reduce((sum, c) => sum + c.supportingArticles.length, 0);
  const gaps = clusters.reduce((sum, c) => sum + c.supportingArticles.filter((a) => a.status === "gap").length, 0);
  const published = clusters.reduce((sum, c) => sum + c.supportingArticles.filter((a) => a.status === "published").length, 0);
  const avgCoverage = Math.round(clusters.reduce((sum, c) => sum + c.coverageScore, 0) / clusters.length);
  const allLinks = clusters.flatMap((c) => c.internalLinks);
  const suggestedLinks = allLinks.filter((l) => l.status === "suggested").length;

  const statusVariant: Record<string, "published" | "draft_status" | "planned" | "gap"> = {
    published: "published", draft: "draft_status", planned: "planned", gap: "gap",
  };

  return (
    <div>
      {/* Coverage banner */}
      <div className="bg-card rounded-xl p-5 border border-border/50 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-foreground font-semibold">Topical Coverage</h2>
            <p className="text-text-muted text-xs mt-0.5">How comprehensively your content covers your key topics</p>
          </div>
          <span className="text-3xl font-bold text-foreground">{avgCoverage}%</span>
        </div>
        <div className="h-3 bg-border/50 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${avgCoverage}%` }} />
        </div>
        <div className="flex gap-6 mt-3 text-xs text-text-muted">
          <span>{clusters.length} topic clusters</span>
          <span>{totalArticles} articles planned</span>
          <span className="text-status-green">{published} published</span>
          <span className="text-status-red">{gaps} content gaps</span>
        </div>
      </div>

      {/* Cluster cards */}
      <div className="space-y-4 mb-8">
        {clusters.map((cluster) => {
          const gapCount = cluster.supportingArticles.filter((a) => a.status === "gap").length;
          const pubCount = cluster.supportingArticles.filter((a) => a.status === "published").length;
          return (
            <div key={cluster.id} className="bg-card rounded-xl border border-border/50 overflow-hidden">
              <div className="p-5 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-foreground font-semibold">{cluster.pillarTopic}</h3>
                    <Badge variant={statusVariant[cluster.pillarStatus]}>{cluster.pillarStatus}</Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-text-muted">Coverage</p>
                      <p className={`text-sm font-bold ${cluster.coverageScore >= 70 ? "text-status-green" : cluster.coverageScore >= 40 ? "text-status-yellow" : "text-status-red"}`}>
                        {cluster.coverageScore}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-muted">Volume</p>
                      <p className="text-sm font-semibold text-foreground">{cluster.totalVolume.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-muted">Articles</p>
                      <p className="text-sm text-foreground"><span className="text-status-green">{pubCount}</span>/{cluster.supportingArticles.length}</p>
                    </div>
                  </div>
                </div>
                {/* Coverage bar */}
                <div className="h-1.5 bg-border/50 rounded-full overflow-hidden mt-3">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${cluster.coverageScore}%` }} />
                </div>
              </div>

              {/* Supporting articles */}
              <div className="divide-y divide-border/20">
                {cluster.supportingArticles.map((article) => (
                  <div key={article.id} className={`px-5 py-3 flex items-center justify-between hover:bg-card-hover transition-colors ${article.status === "gap" ? "bg-status-red/[0.02]" : ""}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {article.contentScore !== null ? (
                        <ContentScoreRing score={article.contentScore} size={32} strokeWidth={2.5} />
                      ) : (
                        <div className="w-8 h-8 rounded-full border border-dashed border-border flex items-center justify-center">
                          <span className="text-text-muted text-[9px]">—</span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${article.status === "gap" ? "text-text-muted italic" : "text-foreground"}`}>
                          {article.title}
                        </p>
                        <p className="text-text-muted text-xs">{article.targetKeyword} · {article.volume.toLocaleString()} vol.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {article.position && (
                        <span className={`text-xs font-bold ${article.position <= 10 ? "text-status-green" : "text-text-secondary"}`}>
                          #{article.position}
                        </span>
                      )}
                      {article.linkedToPillar && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-500">linked</span>
                      )}
                      <Badge variant={statusVariant[article.status]}>{article.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>

              {gapCount > 0 && (
                <div className="px-5 py-3 bg-status-red/[0.03] border-t border-border/30">
                  <p className="text-status-red text-xs font-medium">{gapCount} content gap{gapCount > 1 ? "s" : ""} — write these to improve coverage</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Internal Linking */}
      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <div className="p-5 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Internal Links</h2>
            <p className="text-text-muted text-xs mt-0.5">{allLinks.length} links tracked · {suggestedLinks} suggested</p>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Source</th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Target</th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Anchor Text</th>
              <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Status</th>
              <th className="text-center px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Equity</th>
            </tr>
          </thead>
          <tbody>
            {allLinks.map((link) => (
              <tr key={link.id} className="border-b border-border/20 last:border-0 hover:bg-card-hover transition-colors">
                <td className="px-5 py-2.5 text-sm text-foreground truncate max-w-[200px]">{link.sourceTitle}</td>
                <td className="px-3 py-2.5 text-sm text-text-secondary truncate max-w-[200px]">{link.targetTitle}</td>
                <td className="px-3 py-2.5 text-xs text-primary-500">{link.anchorText}</td>
                <td className="px-3 py-2.5 text-center">
                  <Badge variant={link.status === "active" ? "published" : link.status === "suggested" ? "planned" : "gap"}>
                    {link.status}
                  </Badge>
                </td>
                <td className="px-5 py-2.5 text-center">
                  <span className={`text-xs font-medium ${link.linkEquity === "high" ? "text-status-green" : link.linkEquity === "medium" ? "text-status-yellow" : "text-text-muted"}`}>
                    {link.linkEquity}
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
