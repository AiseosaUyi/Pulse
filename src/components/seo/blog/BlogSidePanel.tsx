// Right-side drawer that opens when a user clicks a blog card. Shows
// full score breakdown, full-size Google preview, FAQ schema preview,
// metadata, and an "Open editor" button that routes to the actual
// edit experience. Phase C separates browsing from editing — the
// panel is read-only; editing happens via the Edit button.

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X, Pencil, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import type { BlogPostRecord } from "@/lib/types/blog-posts";
import { buildGooglePreview } from "@/lib/blog/google-preview";
import { buildBlogUrls } from "@/lib/seo/blog-urls";
import type { TenantSeoConfig } from "@/lib/seo/tenant-seo-config";
import type { SucceededPublishTargets } from "@/lib/services/seo-publish-runs";
import { GoogleSerpPreview } from "./GoogleSerpPreview";
import { FaqSchemaBadge } from "./FaqSchemaBadge";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { extractFaqFromMarkdown } from "@/lib/ai/score-subscores/faq";

export function BlogSidePanel({
  post,
  tenantDomain,
  seo,
  succeededTargets,
  onClose,
}: {
  post: BlogPostRecord;
  tenantDomain: string;
  /** Tenant SEO config — used to derive a durable staging/live link for
   *  posts that have already been published, without opening the editor. */
  seo: TenantSeoConfig;
  /** Which publish target(s) this post has an actual succeeded
   *  seo_publish_runs row for. post.status alone can't tell a staging-only
   *  publish from a live one (mark_published sets "published" for either
   *  target) — this gates which link is actually safe to show. */
  succeededTargets: SucceededPublishTargets;
  onClose: () => void;
}) {
  // Close on Escape — common drawer UX.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const preview =
    post.googlePreview ??
    buildGooglePreview({
      title: post.title,
      metaDescription: post.metaDescription,
      slug: post.slug,
      tenantDomain,
    });

  const faqs = extractFaqFromMarkdown(post.content).questions;

  // Durable staging/live links for an already-published post, so the user
  // can jump straight to it from the list without opening the editor.
  // Computed from the post's slug (see buildBlogUrls) and gated per-target
  // by succeededTargets — NOT post.status, which is identical for a
  // staging-only publish and a live one.
  const urlsBySlug = buildBlogUrls(post.slug, seo);
  const publishedUrls = {
    liveUrl: succeededTargets.live ? urlsBySlug.liveUrl : null,
    stagingUrl: succeededTargets.test ? urlsBySlug.stagingUrl : null,
  };
  const hasPublishedLink = Boolean(
    publishedUrls.liveUrl || publishedUrls.stagingUrl
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="bg-card w-full md:max-w-[640px] h-full border-l border-border flex flex-col shadow-2xl"
        role="dialog"
        aria-label={`Preview of ${post.title}`}
      >
        <div className="p-5 border-b border-border/30 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={
                  post.status === "published"
                    ? "published"
                    : post.status === "review"
                      ? "planned"
                      : post.status === "archived"
                        ? "dismissed"
                        : "draft_status"
                }
              >
                {post.status}
              </Badge>
              {post.scoreWarning && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-status-yellow/10 border border-status-yellow/30 text-status-yellow">
                  <AlertTriangle size={10} />
                  Flagged
                </span>
              )}
              <FaqSchemaBadge faqSchema={post.faqSchema} />
            </div>
            <h2 className="text-lg font-semibold text-foreground mt-2 line-clamp-2">
              {post.title}
            </h2>
            <p className="text-xs text-text-muted mt-1">
              {post.wordCount.toLocaleString()} words ·{" "}
              {post.targetKeyword ? `target: ${post.targetKeyword}` : "no target keyword"} ·
              updated{" "}
              {new Date(post.updatedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
            {hasPublishedLink && (
              <div className="flex items-center gap-3 mt-1.5">
                {publishedUrls.liveUrl && (
                  <a
                    href={publishedUrls.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-primary-500 hover:underline"
                  >
                    <ExternalLink size={11} /> Live
                  </a>
                )}
                {publishedUrls.stagingUrl && (
                  <a
                    href={publishedUrls.stagingUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-primary-500 hover:underline"
                  >
                    <ExternalLink size={11} /> Staging
                  </a>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground p-1"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {/* Score breakdown */}
          <ScoreBreakdown
            total={post.contentScore}
            subScores={post.subScores}
            issues={post.scoreIssues}
            warning={post.scoreWarning}
          />

          {/* Google SERP preview */}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
              Google preview
            </p>
            <GoogleSerpPreview preview={preview} variant="full" />
          </div>

          {/* FAQ preview (read-only) */}
          {faqs.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                FAQ section ({faqs.length} Q{faqs.length === 1 ? "" : "s"})
              </p>
              <ul className="space-y-2">
                {faqs.slice(0, 6).map((f, i) => (
                  <li
                    key={i}
                    className="bg-sidebar border border-border rounded-lg p-3"
                  >
                    <p className="text-sm text-foreground font-medium">
                      {f.q}
                    </p>
                    <p className="text-xs text-text-muted mt-1 line-clamp-2">
                      {f.a}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Outline */}
          {post.outline.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                Heading structure
              </p>
              <ul className="space-y-1.5">
                {post.outline.map((item, i) => (
                  <li key={i} className="text-sm text-foreground">
                    <span className="text-[10px] uppercase text-text-muted mr-2">
                      H2
                    </span>
                    {item.heading}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Meta facts */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {post.secondaryKeywords.length > 0 && (
              <div className="col-span-2">
                <p className="text-text-muted uppercase tracking-wide font-semibold mb-1">
                  Secondary keywords
                </p>
                <div className="flex flex-wrap gap-1">
                  {post.secondaryKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="px-1.5 py-0.5 rounded bg-background text-text-secondary"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {post.generationMeta && (
              <div className="col-span-2">
                <p className="text-text-muted uppercase tracking-wide font-semibold mb-1">
                  Generation
                </p>
                <p className="text-text-secondary">
                  {post.generationMeta.passes.length} pass{post.generationMeta.passes.length === 1 ? "" : "es"} ·{" "}
                  final word count {post.generationMeta.final_word_count} vs target {post.generationMeta.target_word_count} ·{" "}
                  spent ${post.generationMeta.total_cost_usd.toFixed(3)}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-border/30 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button asChild>
            <Link href={`/seo-tracker/blog-writer/${post.id}`}>
              <Pencil size={14} />
              Open editor
            </Link>
          </Button>
        </div>
      </aside>
    </div>
  );
}
