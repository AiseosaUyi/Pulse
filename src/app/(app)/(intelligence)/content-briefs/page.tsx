import { cookies } from "next/headers";
import { getContentBriefs } from "@/lib/services/content";
import { Badge } from "@/components/ui/Badge";

export default async function ContentBriefsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const briefs = await getContentBriefs(tenantSlug);

  return (
    <div className="p-4 md:p-8 max-w-[1000px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content Briefs</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            AI-generated content strategies from competitive intelligence
          </p>
        </div>
        <div className="text-sm text-text-muted">
          {briefs.length} brief{briefs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Empty State */}
      {briefs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <div className="text-2xl mb-3">📝</div>
          <h3 className="text-foreground font-semibold mb-1">No briefs yet</h3>
          <p className="text-text-muted text-sm mb-4">
            Head to the{" "}
            <a
              href="/intel-feed"
              className="text-accent-purple hover:underline"
            >
              Intel Feed
            </a>{" "}
            and tap &quot;Steal This&quot; on a competitor post to generate your
            first brief.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {briefs.map((brief) => (
            <div
              key={brief.id}
              className="bg-card rounded-xl border border-border/50 overflow-hidden"
            >
              {/* Brief Header */}
              <div className="p-5 border-b border-border/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-foreground font-semibold">{brief.title}</h3>
                      <Badge
                        variant={
                          brief.status === "published"
                            ? "published"
                            : "draft_status"
                        }
                      >
                        {brief.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </div>
                    <p className="text-text-muted text-xs mt-1">
                      {brief.platform.charAt(0).toUpperCase() +
                        brief.platform.slice(1)}{" "}
                      · {brief.contentType} · Generated{" "}
                      {new Date(brief.generatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Brief Content */}
              <div className="p-5">
                {/* Outline */}
                <div className="mb-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                    Outline
                  </h4>
                  <ul className="space-y-1.5">
                    {brief.outline.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-text-secondary flex items-start gap-2"
                      >
                        <span className="text-accent-purple text-xs mt-0.5 shrink-0">
                          {i + 1}.
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Draft Content */}
                <div className="mb-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                    Draft Content
                  </h4>
                  <div className="bg-sidebar rounded-lg p-4 text-sm leading-relaxed text-foreground/80 border-l-2 border-accent-purple/30">
                    {brief.draftContent}
                  </div>
                </div>

                {/* SEO Keywords */}
                {brief.seoKeywords && brief.seoKeywords.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                      Target Keywords
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {brief.seoKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="px-2 py-0.5 rounded-full bg-accent-purple/10 border border-accent-purple/20 text-xs text-purple-300"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
