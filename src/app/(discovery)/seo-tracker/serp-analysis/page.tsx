import { cookies } from "next/headers";
import Link from "next/link";
import { getSERPAnalyses } from "@/lib/services/seo";
import { Badge } from "@/components/ui/Badge";

export default async function SERPAnalysisPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const analyses = await getSERPAnalyses(tenantSlug);
  const featured = analyses[0];

  return (
    <div>
      {/* Keyword selector */}
      <div className="flex gap-2 mb-6">
        {analyses.map((a, i) => (
          <button
            key={a.id}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              i === 0 ? "gradient-purple-pink text-white" : "bg-card border border-border/50 text-text-secondary hover:text-white"
            }`}
          >
            {a.keyword}
          </button>
        ))}
      </div>

      {featured && (
        <div className="grid grid-cols-5 gap-6">
          {/* SERP Results */}
          <div className="col-span-3 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white">
                Top Results for &ldquo;{featured.keyword}&rdquo;
              </h2>
              <span className="text-text-muted text-xs">{featured.volume.toLocaleString()} monthly searches</span>
            </div>

            {featured.results.map((result) => {
              const isUs = featured.ourUrl && result.url.includes(tenantSlug === "gruve" ? "gruve" : "sippy");
              return (
                <div
                  key={result.position}
                  className={`bg-card rounded-xl p-4 border transition-colors ${
                    isUs ? "border-accent-purple/50 bg-accent-purple/[0.03]" : "border-border/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`text-lg font-bold flex-shrink-0 w-8 ${
                      result.position <= 3 ? "text-status-green" : "text-text-muted"
                    }`}>
                      #{result.position}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{result.title}</p>
                      <p className="text-status-green text-xs mt-0.5 truncate">{result.url}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-text-muted text-xs">DA: <span className="text-text-secondary">{result.domainAuthority}</span></span>
                        <span className="text-text-muted text-xs">{result.wordCount.toLocaleString()} words</span>
                        <span className="text-text-muted text-xs">{result.backlinks} backlinks</span>
                        <span className="text-text-muted text-xs">{result.contentAge}</span>
                        {result.hasSchema && <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-green/10 text-status-green">Schema</span>}
                        {result.hasFAQ && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-purple/10 text-accent-purple">FAQ</span>}
                        {result.hasVideo && <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-teal/10 text-status-teal">Video</span>}
                      </div>
                    </div>
                    {isUs && <span className="text-[9px] px-2 py-1 rounded gradient-purple-pink text-white font-medium">YOU</span>}
                  </div>
                </div>
              );
            })}

            {featured.ourPosition && featured.ourPosition > 5 && (
              <div className="bg-accent-purple/5 border border-accent-purple/20 rounded-xl p-4">
                <p className="text-accent-purple text-sm font-medium">
                  You&apos;re at position #{featured.ourPosition} for &ldquo;{featured.keyword}&rdquo;
                </p>
                <p className="text-text-muted text-xs mt-1">
                  The top result has {featured.results[0]?.wordCount.toLocaleString()} words and {featured.results[0]?.backlinks} backlinks.
                  Your content needs {featured.recommendedWordCount.toLocaleString()}+ words to compete.
                </p>
              </div>
            )}
          </div>

          {/* Analysis Sidebar */}
          <div className="col-span-2 space-y-4">
            {/* Recommendations */}
            <div className="bg-card rounded-xl p-5 border border-border/50">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white mb-3">To Rank for This Keyword</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-xs">Recommended Word Count</span>
                  <span className="text-white text-sm font-semibold">{featured.recommendedWordCount.toLocaleString()}+</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-xs">Avg. Competitor DA</span>
                  <span className="text-white text-sm font-semibold">{featured.avgDomainAuthority}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-xs">Avg. Competitor Words</span>
                  <span className="text-white text-sm font-semibold">{featured.avgWordCount.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-xs">Difficulty</span>
                  <Badge variant={featured.difficulty === "easy" ? "published" : featured.difficulty === "medium" ? "draft_status" : "gap"}>
                    {featured.difficulty}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Recommended Headings */}
            <div className="bg-card rounded-xl p-5 border border-border/50">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white mb-3">Recommended Headings</h3>
              <div className="space-y-1.5">
                {featured.recommendedHeadings.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-accent-purple bg-accent-purple/10 px-1.5 py-0.5 rounded">H2</span>
                    <span className="text-sm text-text-secondary">{h}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Content Gaps */}
            <div className="bg-card rounded-xl p-5 border border-border/50">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white mb-3">Content Gaps</h3>
              <p className="text-text-muted text-xs mb-3">Topics competitors cover that you don&apos;t:</p>
              <div className="space-y-2">
                {featured.contentGaps.map((gap, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-status-red/[0.03] border border-status-red/10">
                    <span className="text-status-red text-xs">-</span>
                    <span className="text-text-secondary text-sm">{gap}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <Link
              href="/seo-tracker/blog-writer"
              className="block w-full px-4 py-3 gradient-purple-pink text-white text-sm font-medium rounded-xl hover:opacity-90 transition-opacity text-center active:scale-[0.98]"
            >
              Generate Blog Post from This Analysis
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
