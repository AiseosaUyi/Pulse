// Blog list card — replaces the click-opens-editor row from pre-
// Phase-C. Clicking a card opens the side panel (score breakdown +
// SERP preview). A separate Edit button is exposed on the side panel,
// not here — preserves the reader/editor separation the user asked
// for.

import { Badge } from "@/components/ui/Badge";
import type {
  BlogPostRecord,
  BlogPostStatus,
} from "@/lib/types/blog-posts";
import { GoogleSerpPreview } from "./GoogleSerpPreview";
import { FaqSchemaBadge } from "./FaqSchemaBadge";
import { buildGooglePreview } from "@/lib/blog/google-preview";

function statusBadge(status: BlogPostStatus) {
  switch (status) {
    case "draft":
    case "editing":
      return "draft_status" as const;
    case "review":
      return "planned" as const;
    case "published":
      return "published" as const;
    case "archived":
      return "dismissed" as const;
    case "publish_failed":
      return "publish_failed" as const;
  }
}

function scoreTone(score: number | null) {
  if (score == null) return { cls: "bg-sidebar border-border text-text-muted", label: "—" };
  if (score >= 90)
    return {
      cls: "bg-status-teal/10 border-status-teal/30 text-status-teal",
      label: String(score),
    };
  if (score >= 80)
    return {
      cls: "bg-status-green/10 border-status-green/30 text-status-green",
      label: String(score),
    };
  if (score >= 70)
    return {
      cls: "bg-status-yellow/10 border-status-yellow/30 text-status-yellow",
      label: String(score),
    };
  return {
    cls: "bg-status-red/10 border-status-red/30 text-status-red",
    label: String(score),
  };
}

export function BlogCard({
  post,
  tenantDomain,
  onOpen,
}: {
  post: BlogPostRecord;
  tenantDomain: string;
  onOpen: () => void;
}) {
  const score = scoreTone(post.contentScore);

  // Always derive from the post's current title/meta/slug rather than
  // trusting the cached blog_posts.google_preview column: that cache is
  // only written at creation/regeneration time (see buildGooglePreview
  // call sites in lib/actions/blog-posts.ts, blog-regeneration.ts,
  // blog-sections.ts) and NOT by the plain title/meta edit path
  // (updateBlogPost in lib/actions/blog-posts.ts) — a post whose title
  // was hand-edited and saved keeps showing its old title/slug here
  // indefinitely. Recomputing is cheap (pure truncation, no AI/network
  // cost) so there's no real upside to preferring the stale cache.
  const preview = buildGooglePreview({
    title: post.title,
    metaDescription: post.metaDescription,
    slug: post.slug,
    tenantDomain,
  });

  const excerpt =
    post.metaDescription?.trim() ||
    post.outline?.[0]?.bullets?.[0] ||
    post.content.slice(0, 200);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-card rounded-2xl border border-border p-5 hover:border-primary-500/50 transition-colors"
    >
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        {/* Score ring */}
        <div className="shrink-0 relative w-14 h-14">
          <svg viewBox="0 0 56 56" className="w-14 h-14">
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
            {post.contentScore != null && (
              <circle
                cx="28"
                cy="28"
                r="24"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(post.contentScore / 100) * 151} 151`}
                transform="rotate(-90 28 28)"
                className={
                  post.contentScore >= 90
                    ? "text-status-teal"
                    : post.contentScore >= 80
                      ? "text-status-green"
                      : post.contentScore >= 70
                        ? "text-status-yellow"
                        : "text-status-red"
                }
                stroke="currentColor"
              />
            )}
          </svg>
          <div
            className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${
              post.contentScore == null
                ? "text-text-muted"
                : post.contentScore >= 90
                  ? "text-status-teal"
                  : post.contentScore >= 80
                    ? "text-status-green"
                    : post.contentScore >= 70
                      ? "text-status-yellow"
                      : "text-status-red"
            }`}
          >
            {score.label}
          </div>
        </div>

        {/* Main column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h3 className="text-foreground font-semibold leading-snug">
              {post.title}
            </h3>
            <div className="flex items-center gap-2 shrink-0">
              {post.scoreWarning && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-yellow/10 border border-status-yellow/30 text-status-yellow"
                  title="Iteration budget exhausted without hitting 80. Review issues in the side panel."
                >
                  flagged
                </span>
              )}
              <Badge variant={statusBadge(post.status)}>{post.status}</Badge>
            </div>
          </div>

          <p className="text-sm text-text-secondary line-clamp-2 mt-1.5">
            {excerpt}
          </p>

          <div className="flex items-center gap-3 text-xs text-text-muted mt-3 flex-wrap">
            {post.targetKeyword && (
              <span>
                Target:{" "}
                <span className="text-foreground">{post.targetKeyword}</span>
              </span>
            )}
            <span>{post.wordCount.toLocaleString()} words</span>
            <FaqSchemaBadge faqSchema={post.faqSchema} />
            <span>·</span>
            <span>
              Updated{" "}
              {new Date(post.updatedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* SERP mini preview — hide on very narrow screens */}
        <div className="hidden lg:block w-[280px] shrink-0">
          <GoogleSerpPreview preview={preview} variant="mini" />
        </div>
      </div>
    </button>
  );
}
