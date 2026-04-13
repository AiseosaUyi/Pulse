import { cookies } from "next/headers";
import { mockCompetitors } from "@/lib/data/mock-modules";
import { Badge } from "@/components/ui/Badge";

export default async function CompetitionPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const competitors = mockCompetitors[tenantSlug] ?? mockCompetitors.gruve;

  const threatBadge: Record<string, { variant: "urgent" | "needs_posts" | "active"; label: string }> = {
    high: { variant: "urgent", label: "High Threat" },
    medium: { variant: "needs_posts", label: "Medium" },
    low: { variant: "active", label: "Low" },
  };

  return (
    <div className="p-8 max-w-[1200px]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Competition</h1>
        <p className="text-text-secondary text-sm mt-0.5">Competitor analysis and market positioning</p>
      </div>

      <div className="space-y-6">
        {competitors.map((comp) => (
          <div key={comp.name} className="bg-card rounded-xl border border-border/50 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-border/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-semibold text-lg">{comp.name}</h3>
                    <Badge variant={threatBadge[comp.threatLevel].variant}>
                      {threatBadge[comp.threatLevel].label}
                    </Badge>
                  </div>
                  <p className="text-text-muted text-sm mt-0.5">{comp.website}</p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-3 gap-6">
                {/* Social Presence */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">Social Presence</h4>
                  <div className="space-y-2.5">
                    {comp.platforms.map((p) => (
                      <div key={p.name} className="flex items-center justify-between">
                        <span className="text-text-secondary text-sm">{p.name}</span>
                        <div className="text-right">
                          <span className="text-white text-sm font-medium">{p.followers.toLocaleString()}</span>
                          <span className="text-text-muted text-xs ml-2">{p.engagement}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Strengths */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-status-green mb-3">Strengths</h4>
                  <ul className="space-y-1.5">
                    {comp.strengths.map((s) => (
                      <li key={s} className="text-text-secondary text-sm flex items-start gap-2">
                        <span className="text-status-green mt-1 text-xs">+</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Weaknesses */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-status-red mb-3">Weaknesses</h4>
                  <ul className="space-y-1.5">
                    {comp.weaknesses.map((w) => (
                      <li key={w} className="text-text-secondary text-sm flex items-start gap-2">
                        <span className="text-status-red mt-1 text-xs">-</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
