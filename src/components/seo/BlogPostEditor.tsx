"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { updateBlogPost, deleteBlogPost } from "@/lib/actions/blog-posts";
import type { BlogPostRecord, BlogPostStatus } from "@/lib/types/blog-posts";

const STATUS_OPTIONS: BlogPostStatus[] = [
  "draft",
  "editing",
  "review",
  "published",
  "archived",
];

export function BlogPostEditor({
  post,
  tenantSlug,
  onClose,
}: {
  post: BlogPostRecord;
  tenantSlug: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [metaDescription, setMetaDescription] = useState(
    post.metaDescription ?? ""
  );
  const [content, setContent] = useState(post.content);
  const [status, setStatus] = useState<BlogPostStatus>(post.status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title !== post.title ||
    metaDescription !== (post.metaDescription ?? "") ||
    content !== post.content ||
    status !== post.status;

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateBlogPost(post.id, tenantSlug, {
        title,
        metaDescription,
        content,
        status,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteBlogPost(post.id, tenantSlug);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const metaLen = metaDescription.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-card w-full md:max-w-[900px] md:rounded-2xl border border-border flex flex-col max-h-screen">
        <div className="p-5 border-b border-border/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-foreground font-semibold truncate">
              Edit blog post
            </h2>
            {dirty && (
              <span
                className="w-2 h-2 rounded-full bg-primary-500 shrink-0"
                aria-label="Unsaved changes"
                title="Unsaved changes"
              />
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <Label htmlFor="bp-title">Title</Label>
            <Input
              id="bp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="bp-meta">
                Meta description ({metaLen}/160)
              </Label>
              <Textarea
                id="bp-meta"
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="bp-status">Status</Label>
              <select
                id="bp-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as BlogPostStatus)}
                disabled={isPending}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground capitalize"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {post.targetKeyword && (
                <p className="text-xs text-text-muted mt-2">
                  Target keyword:{" "}
                  <span className="text-foreground">{post.targetKeyword}</span>
                </p>
              )}
              {post.secondaryKeywords.length > 0 && (
                <p className="text-xs text-text-muted mt-1">
                  Secondary: {post.secondaryKeywords.join(", ")}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="bp-content">Content (markdown) · {wordCount} words</Label>
            <Textarea
              id="bp-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={24}
              disabled={isPending}
              className="font-mono text-xs leading-relaxed"
            />
          </div>

          {post.outline.length > 0 && (
            <div>
              <Label>Outline (read-only)</Label>
              <ul className="text-sm text-text-secondary bg-sidebar rounded-lg p-4 border border-border/30 space-y-2">
                {post.outline.map((item, i) => (
                  <li key={i}>
                    <p className="font-medium text-foreground">{item.heading}</p>
                    {item.bullets.length > 0 && (
                      <ul className="list-disc ml-5 mt-1 text-xs text-text-muted space-y-0.5">
                        {item.bullets.map((b, j) => (
                          <li key={j}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="p-5 border-t border-border/30 flex items-center justify-between gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="text-red-500 hover:text-red-600"
          >
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!dirty || isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
