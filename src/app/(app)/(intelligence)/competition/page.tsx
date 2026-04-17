import { Badge } from "@/components/ui/Badge";
import { getCurrentTenant } from "@/lib/auth";
import { getCompetitors } from "@/lib/services/intelligence";
import type { CompetitorPlatform } from "@/lib/types/intelligence";
import { AddCompetitorButton } from "./client";

const threatBadge: Record<"high" | "medium" | "low", { variant: "urgent" | "needs_posts" | "active"; label: string }> = {
  high: { variant: "urgent", label: "High Threat" },
  medium: { variant: "needs_posts", label: "Medium" },
  low: { variant: "active", label: "Low" },
};

const typeBadge: Record<"direct" | "aspirational" | "adjacent", string> = {
  direct: "Direct",
  aspirational: "Aspirational",
  adjacent: "Adjacent",
};

const platformLabels: Record<CompetitorPlatform["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
  blog: "Blog",
};

export default async function CompetitionPage() {
  const tenant = await getCurrentTenant();
  const competitors = tenant ? await getCompetitors(tenant.slug) : [];

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Competition</h1>
          <p className="text-text-secondary text-sm mt-0.5">Competitor analysis and market positioning</p>
        </div>
        <AddCompetitorButton />
      </div>

      {competitors.length === 0 ? (
        <div className="bg-card rounded-xl border border-border/50 p-10 text-center">
          <p className="text-sm text-foreground font-medium">No competitors yet</p>
          <p className="text-text-secondary text-xs mt-1">
            Click &ldquo;Add Competitor&rdquo; to start tracking rivals and opportunities.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {competitors.map((comp) => (
            <div key={comp.id} className="bg-card rounded-xl border border-border/50 overflow-hidden">
              <div className="p-6 border-b border-border/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-foreground font-semibold text-lg">{comp.name}</h3>
                      <Badge variant={threatBadge[comp.threatLevel].variant}>
                        {threatBadge[comp.threatLevel].label}
                      </Badge>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-background text-text-muted">
                        {typeBadge[comp.type]}
                      </span>
                    </div>
                    {comp.website && <p className="text-text-muted text-sm mt-0.5">{comp.website}</p>}
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
                      Social Presence
                    </h4>
                    {comp.platforms.length === 0 ? (
                      <p className="text-text-muted text-sm">No platforms tracked</p>
                    ) : (
                      <div className="space-y-2.5">
                        {comp.platforms.map((p) => (
                          <div key={p.platform} className="flex items-center justify-between">
                            <span className="text-text-secondary text-sm">
                              {platformLabels[p.platform]}
                            </span>
                            <div className="text-right">
                              <span className="text-foreground text-sm font-medium">
                                {p.followers.toLocaleString()}
                              </span>
                              <span className="text-text-muted text-xs ml-2">{p.engagementRate}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-status-green mb-3">
                      Strengths
                    </h4>
                    {comp.strengths.length === 0 ? (
                      <p className="text-text-muted text-sm">—</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {comp.strengths.map((s) => (
                          <li key={s} className="text-text-secondary text-sm flex items-start gap-2">
                            <span className="text-status-green mt-1 text-xs">+</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-status-red mb-3">
                      Weaknesses
                    </h4>
                    {comp.weaknesses.length === 0 ? (
                      <p className="text-text-muted text-sm">—</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {comp.weaknesses.map((w) => (
                          <li key={w} className="text-text-secondary text-sm flex items-start gap-2">
                            <span className="text-status-red mt-1 text-xs">-</span>
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
