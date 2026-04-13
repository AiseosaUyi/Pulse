import { cookies } from "next/headers";
import { getProgrammaticTemplates } from "@/lib/services/seo";
import { Badge } from "@/components/ui/Badge";

export default async function ProgrammaticPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const templates = await getProgrammaticTemplates(tenantSlug);

  const totalPages = templates.reduce((sum, t) => sum + t.totalPages, 0);
  const indexedPages = templates.reduce((sum, t) => sum + t.indexedPages, 0);
  const totalImpressions = templates.reduce((sum, t) => sum + t.generatedPages.reduce((s, p) => s + p.impressions, 0), 0);
  const totalClicks = templates.reduce((sum, t) => sum + t.generatedPages.reduce((s, p) => s + p.clicks, 0), 0);

  const pageStatusVariant: Record<string, "published" | "draft_status" | "planned" | "gap"> = {
    ranking: "published", indexed: "planned", generated: "draft_status", not_indexed: "gap",
  };

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Pages</p>
          <p className="text-2xl font-bold text-white mt-1">{totalPages}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Indexed</p>
          <p className="text-2xl font-bold text-status-green mt-1">{indexedPages}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Index Rate</p>
          <p className="text-2xl font-bold text-white mt-1">{totalPages > 0 ? Math.round((indexedPages / totalPages) * 100) : 0}%</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Impressions</p>
          <p className="text-2xl font-bold text-white mt-1">{(totalImpressions / 1000).toFixed(1)}K</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Clicks</p>
          <p className="text-2xl font-bold text-accent-purple mt-1">{totalClicks.toLocaleString()}</p>
        </div>
      </div>

      {/* Templates */}
      {templates.map((template) => (
        <div key={template.id} className="bg-card rounded-xl border border-border/50 overflow-hidden mb-6">
          <div className="p-5 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold">{template.name}</h3>
                <p className="text-accent-purple text-sm mt-0.5 font-mono">{template.pattern}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>{template.totalPages} pages</span>
                <span className="text-status-green">{template.indexedPages} indexed</span>
                {template.avgPosition && <span>Avg. #{template.avgPosition}</span>}
              </div>
            </div>
            {/* Variables */}
            <div className="flex gap-2 mt-3">
              {template.variables.map((v) => (
                <div key={v.name} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-text-muted uppercase">{v.name}:</span>
                  <div className="flex gap-1">
                    {v.values.map((val) => (
                      <span key={val} className="text-[10px] px-1.5 py-0.5 rounded bg-background text-text-secondary">{val}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Page Title</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Slug</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Status</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Position</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Impressions</th>
                <th className="text-right px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {template.generatedPages.map((page) => (
                <tr key={page.id} className="border-b border-border/20 last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-5 py-2.5 text-sm text-white">{page.title}</td>
                  <td className="px-3 py-2.5 text-xs text-text-muted font-mono">/{page.slug}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Badge variant={pageStatusVariant[page.status]}>{page.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {page.position ? (
                      <span className={`text-sm font-bold ${page.position <= 10 ? "text-status-green" : page.position <= 20 ? "text-status-yellow" : "text-text-secondary"}`}>
                        #{page.position}
                      </span>
                    ) : <span className="text-text-muted text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-text-secondary text-right">{page.impressions > 0 ? page.impressions.toLocaleString() : "—"}</td>
                  <td className="px-5 py-2.5 text-sm text-text-secondary text-right">{page.clicks > 0 ? page.clicks.toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
