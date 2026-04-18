"use client";

import { useState } from "react";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlogPostEditor } from "@/components/seo/BlogPostEditor";
import { NewBlogPostModal } from "@/components/seo/NewBlogPostModal";
import { BlogCard } from "@/components/seo/blog/BlogCard";
import { BlogSidePanel } from "@/components/seo/blog/BlogSidePanel";
import type { BlogPostRecord } from "@/lib/types/blog-posts";

/**
 * Phase C flow:
 *   card click     → opens side panel (read-only)
 *   panel "Edit"   → opens full editor (the old "row click" destination)
 *
 * Keeps browsing distinct from editing.
 */
export function BlogWriterClient({
  posts,
  tenantSlug,
  tenantDomain,
  trackedKeywords,
}: {
  posts: BlogPostRecord[];
  tenantSlug: string;
  tenantDomain: string;
  trackedKeywords: string[];
}) {
  const [showNew, setShowNew] = useState(false);
  // Null = nothing open. Both states refer to a post BY ID so the UI
  // stays stable across list re-renders.
  const [panelId, setPanelId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const panelPost = panelId ? posts.find((p) => p.id === panelId) ?? null : null;
  const editingPost = editingId ? posts.find((p) => p.id === editingId) ?? null : null;

  return (
    <>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <p className="text-foreground font-semibold text-lg">Blog posts</p>
          <p className="text-text-muted text-xs mt-0.5">
            {posts.length} post{posts.length === 1 ? "" : "s"} · click to preview, open the editor from the panel.
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
            Click &quot;New draft&quot; — pick a keyword, type a title, or just
            give context. Brand positioning applies automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <BlogCard
              key={p.id}
              post={p}
              tenantDomain={tenantDomain}
              onOpen={() => setPanelId(p.id)}
            />
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

      {panelPost && (
        <BlogSidePanel
          post={panelPost}
          tenantDomain={tenantDomain}
          onClose={() => setPanelId(null)}
          onEdit={() => {
            // Open the editor on top of the side panel. Closing the
            // editor returns the user to the panel so they can keep
            // comparing score vs. preview.
            setEditingId(panelPost.id);
          }}
        />
      )}

      {editingPost && (
        <BlogPostEditor
          post={editingPost}
          tenantSlug={tenantSlug}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}
