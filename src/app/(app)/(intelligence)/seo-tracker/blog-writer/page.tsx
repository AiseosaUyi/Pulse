import { cookies } from "next/headers";
import { getBlogPosts, getContentScore } from "@/lib/services/seo";
import { ContentScoreRing } from "@/components/seo/ContentScoreRing";
import { SERPPreview } from "@/components/seo/SERPPreview";
import { Badge } from "@/components/ui/Badge";

export default async function BlogWriterPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const posts = await getBlogPosts(tenantSlug);
  const featuredPost = posts[0];
  const featuredScore = featuredPost ? await getContentScore(featuredPost.id) : null;

  const statusVariant: Record<string, "published" | "draft_status" | "planned" | "gap"> = {
    published: "published", editing: "draft_status", review: "planned", generated: "planned",
  };

  const scoreLabels: Record<string, string> = {
    titleOptimization: "Title Optimization",
    keywordDensity: "Keyword Density",
    headingStructure: "Heading Structure",
    metaDescription: "Meta Description",
    readability: "Readability",
    internalLinks: "Internal Links",
    imageAltTags: "Image Alt Tags",
    contentLength: "Content Length",
    faqPresence: "FAQ Presence",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-text-muted text-sm">{posts.length} blog posts</p>
        <button className="px-4 py-2 gradient-purple-pink text-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity active:scale-[0.98]">
          Generate New Post
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
        {/* Post list */}
        <div className="col-span-1 lg:col-span-2 space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`bg-card rounded-xl p-4 border transition-colors cursor-pointer hover:border-accent-purple/50 ${
                post.id === featuredPost?.id ? "border-accent-purple/50" : "border-border/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <ContentScoreRing score={post.contentScore} />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-sm font-medium leading-tight">{post.title}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Badge variant={statusVariant[post.status] ?? "planned"}>{post.status}</Badge>
                    <span className="text-text-muted text-xs">{post.wordCount.toLocaleString()} words</span>
                  </div>
                  <p className="text-text-muted text-xs mt-1">Target: {post.targetKeyword}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {featuredPost && (
          <div className="col-span-1 lg:col-span-3 space-y-4">
            {/* Heading Structure */}
            <div className="bg-card rounded-xl p-5 border border-border/50">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">Heading Structure</h3>
              <div className="space-y-1.5">
                {featuredPost.headingStructure.map((h, i) => (
                  <div key={i} className={`flex items-center gap-2 ${h.level === "h2" ? "ml-4" : h.level === "h3" ? "ml-8" : ""}`}>
                    <span className="text-[10px] font-mono text-accent-purple bg-accent-purple/10 px-1.5 py-0.5 rounded">{h.level}</span>
                    <span className="text-sm text-text-secondary">{h.text}</span>
                    {h.keywordPresent && <span className="text-[9px] px-1 py-0.5 rounded bg-status-green/10 text-status-green">keyword</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Content Score Breakdown */}
            {featuredScore && (
              <div className="bg-card rounded-xl p-5 border border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Content Score</h3>
                  <ContentScoreRing score={featuredScore.overall} size={48} strokeWidth={4} />
                </div>
                <div className="space-y-2.5">
                  {Object.entries(scoreLabels).map(([key, label]) => {
                    const value = featuredScore[key as keyof typeof featuredScore] as number;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-text-secondary text-xs w-32 flex-shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${value >= 8 ? "bg-status-green" : value >= 5 ? "bg-status-yellow" : "bg-status-red"}`}
                            style={{ width: `${value * 10}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-muted w-8 text-right">{value}/10</span>
                      </div>
                    );
                  })}
                </div>
                {/* Improvement suggestions */}
                <div className="mt-4 pt-3 border-t border-border/30">
                  <p className="text-xs font-medium text-foreground mb-2">Improvement Suggestions</p>
                  <div className="space-y-1.5">
                    {featuredScore.imageAltTags < 7 && (
                      <p className="text-xs text-status-yellow">Add alt tags to all images ({featuredScore.imageAltTags}/10)</p>
                    )}
                    {featuredScore.internalLinks < 7 && (
                      <p className="text-xs text-status-yellow">Add 2-3 more internal links ({featuredScore.internalLinks}/10)</p>
                    )}
                    {featuredScore.faqPresence < 5 && (
                      <p className="text-xs text-status-red">Add FAQ section with 3-5 questions ({featuredScore.faqPresence}/10)</p>
                    )}
                    {featuredScore.headingStructure < 7 && (
                      <p className="text-xs text-status-yellow">Add more H2/H3 subheadings ({featuredScore.headingStructure}/10)</p>
                    )}
                    {featuredScore.overall >= 80 && (
                      <p className="text-xs text-status-green">This post is well-optimized. Minor improvements possible.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SERP Preview */}
            <div className="bg-card rounded-xl p-5 border border-border/50">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">Google Preview</h3>
              <SERPPreview
                title={featuredPost.title}
                url={`https://${tenantSlug === "gruve" ? "gruve.events" : "sippy.ng"}/blog/${featuredPost.slug}`}
                description={featuredPost.metaDescription}
              />
            </div>

            {/* FAQ Items */}
            {featuredPost.faqItems.length > 0 && (
              <div className="bg-card rounded-xl p-5 border border-border/50">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">FAQ Schema</h3>
                <div className="space-y-3">
                  {featuredPost.faqItems.map((faq, i) => (
                    <div key={i} className="p-3 rounded-lg bg-background">
                      <p className="text-foreground text-sm font-medium">{faq.question}</p>
                      <p className="text-text-secondary text-xs mt-1 line-clamp-2">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Meta info */}
            <div className="bg-card rounded-xl p-5 border border-border/50">
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] px-2 py-1 rounded bg-accent-purple/10 text-accent-purple">Schema: {featuredPost.schemaMarkup}</span>
                {featuredPost.secondaryKeywords.map((kw) => (
                  <span key={kw} className="text-[10px] px-2 py-1 rounded bg-background text-text-muted">{kw}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
