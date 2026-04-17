"use client";

import { useState } from "react";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { BlogPostEditor } from "@/components/seo/BlogPostEditor";
import { NewBlogPostModal } from "@/components/seo/NewBlogPostModal";
import type { BlogPostRecord, BlogPostStatus } from "@/lib/types/blog-posts";

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
                <Badge variant={statusBadge(p.status)}>{p.status}</Badge>
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
                <span>{p.wordCount.toLocaleString()} words</span>
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
