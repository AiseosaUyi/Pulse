"use client";

import { useState } from "react";
import { Plus, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { BlogPostEditor } from "@/components/seo/BlogPostEditor";
import { NewBlogPostModal } from "@/components/seo/NewBlogPostModal";
import { withinTolerance } from "@/lib/blog/word-count";
import type { BlogPostRecord, BlogPostStatus } from "@/lib/types/blog-posts";

function ContentScoreBadge({
  score,
  warning,
}: {
  score: number | null;
  warning: boolean;
}) {
  if (score == null) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar border border-border text-text-muted"
        title="Not scored yet — rescore from the editor."
      >
        unscored
      </span>
    );
  }
  // 90+ blue, 80-89 green, 70-79 amber, <70 red (rubric v1).
  const tone =
    score >= 90
      ? "text-status-teal border-status-teal/30 bg-status-teal/10"
      : score >= 80
        ? "text-status-green border-status-green/30 bg-status-green/10"
        : score >= 70
          ? "text-status-yellow border-status-yellow/30 bg-status-yellow/10"
          : "text-status-red border-status-red/30 bg-status-red/10";
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${tone}`}
      title={
        warning
          ? `Score ${score}/100. Iteration budget exhausted without hitting 80 — surface issues before publishing.`
          : `Content score ${score}/100`
      }
    >
      {score}
    </span>
  );
}

function WordCountBadge({
  actual,
  target,
  stoppedReason,
}: {
  actual: number;
  target?: number;
  stoppedReason?: string;
}) {
  // No target means the row predates migration 022 — render plain count.
  if (target == null) {
    return <span>{actual.toLocaleString()} words</span>;
  }
  const ok = withinTolerance(actual, target);
  const wasExpanded = stoppedReason === "expanded_to_tolerance";
  const missed = stoppedReason === "max_passes_reached";
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        missed
          ? "text-status-red"
          : wasExpanded
            ? "text-status-yellow"
            : "text-text-muted"
      }`}
      title={
        missed
          ? `Target was ${target}. Landed at ${actual} after 2 expansion passes.`
          : wasExpanded
            ? `Target ${target}. Hit after expansion pass.`
            : `Target ${target}.`
      }
    >
      {missed && <AlertTriangle size={10} />}
      {actual.toLocaleString()} / {target.toLocaleString()} words
      {!ok && missed ? " (short)" : ""}
    </span>
  );
}

function statusBadge(status: BlogPostStatus) {
  switch (status) {
    case "draft":
      return "draft_status" as const;
    case "editing":
      return "draft_status" as const;
    case "review":
      return "planned" as const;
    case "published":
      return "published" as const;
    case "archived":
      return "dismissed" as const;
  }
}

export function BlogWriterClient({
  posts,
  tenantSlug,
  trackedKeywords,
}: {
  posts: BlogPostRecord[];
  tenantSlug: string;
  trackedKeywords: string[];
}) {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<BlogPostRecord | null>(null);

  return (
    <>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <p className="text-foreground font-semibold text-lg">Blog posts</p>
          <p className="text-text-muted text-xs mt-0.5">
            AI generates drafts grounded in your brand voice. You edit, you
            approve, you post.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={14} />
          New draft
        </Button>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <FileText size={24} className="mx-auto text-text-muted mb-3" />
          <h3 className="text-foreground font-semibold mb-1">No drafts yet</h3>
          <p className="text-text-muted text-sm">
            Tap &quot;New draft&quot;, pick one of your tracked keywords, and the
            AI writes a first pass you can edit.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <button
              key={p.id}
              onClick={() => setEditing(p)}
              className="w-full text-left bg-card rounded-2xl border border-border p-5 hover:border-primary-500/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <h3 className="text-foreground font-semibold">{p.title}</h3>
                <div className="flex items-center gap-2">
                  <ContentScoreBadge score={p.contentScore} warning={p.scoreWarning} />
                  <Badge variant={statusBadge(p.status)}>{p.status}</Badge>
                </div>
              </div>
              {p.metaDescription && (
                <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                  {p.metaDescription}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
                {p.targetKeyword && (
                  <span>
                    Target:{" "}
                    <span className="text-foreground">{p.targetKeyword}</span>
                  </span>
                )}
                <WordCountBadge
                  actual={p.wordCount}
                  target={p.generationMeta?.target_word_count}
                  stoppedReason={p.generationMeta?.stopped_reason}
                />
                <span>·</span>
                <span>
                  Updated{" "}
                  {new Date(p.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {showNew && (
        <NewBlogPostModal
          tenantSlug={tenantSlug}
          trackedKeywords={trackedKeywords}
          onClose={() => setShowNew(false)}
        />
      )}

      {editing && (
        <BlogPostEditor
          post={editing}
          tenantSlug={tenantSlug}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
