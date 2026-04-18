"use client";

// Full-page blog editor. Replaces the Phase D modal so the user can
// scan the post naturally while a sticky feedback/regenerate dock
// stays pinned on the right. Back button returns to the list.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import { ArrowLeft, History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/Badge";
import { TiptapEditor, type TiptapChange } from "@/components/seo/blog/TiptapEditor";
import { InlineFeedbackDock } from "@/components/seo/blog/InlineFeedbackDock";
import { VersionHistory } from "@/components/seo/blog/VersionHistory";
import { FeedbackPanel } from "@/components/seo/blog/FeedbackPanel";
import {
  deleteBlogPost,
  updateBlogPost,
} from "@/lib/actions/blog-posts";
import { saveBlogContent } from "@/lib/actions/blog-versions";
import type {
  BlogPostFeedbackRecord,
  BlogPostRecord,
  BlogPostStatus,
  BlogPostVersionRecord,
} from "@/lib/types/blog-posts";

const STATUS_OPTIONS: BlogPostStatus[] = [
  "draft",
  "editing",
  "review",
  "published",
  "archived",
];

export function BlogEditorPageClient({
  post,
  tenantSlug,
  versions,
  feedback,
}: {
  post: BlogPostRecord;
  tenantSlug: string;
  versions: BlogPostVersionRecord[];
  feedback: BlogPostFeedbackRecord[];
}) {
  const router = useRouter();

  const [title, setTitle] = useState(post.title);
  const [metaDescription, setMetaDescription] = useState(
    post.metaDescription ?? ""
  );
  const [status, setStatus] = useState<BlogPostStatus>(post.status);

  const initialJson = useMemo<JSONContent | null>(
    () => (post.contentJson as JSONContent | null) ?? null,
    [post.contentJson]
  );
  const [editorState, setEditorState] = useState<TiptapChange | null>(null);

  // Baseline snapshot (same pattern as the old modal — see the
  // BlogEditor fix commit for the rationale).
  const [baseline, setBaseline] = useState(() => ({
    title: post.title,
    metaDescription: post.metaDescription ?? "",
    status: post.status,
    contentMarkdown: post.content,
  }));

  const [isSaving, startSave] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const current = {
    markdown: editorState?.markdown ?? post.content,
    json: editorState?.json ?? initialJson,
    wordCount: editorState?.wordCount ?? post.wordCount,
  };

  const titleDirty = title !== baseline.title;
  const metaDirty = metaDescription !== baseline.metaDescription;
  const statusDirty = status !== baseline.status;
  const editorDirty =
    editorState !== null && editorState.markdown !== baseline.contentMarkdown;
  const dirty = titleDirty || metaDirty || statusDirty || editorDirty;

  const handleSave = () => {
    setError(null);
    setSaveNotice(null);
    startSave(async () => {
      if (titleDirty || metaDirty || statusDirty) {
        const res = await updateBlogPost(post.id, tenantSlug, {
          title: titleDirty ? title : undefined,
          metaDescription: metaDirty ? metaDescription : undefined,
          status: statusDirty ? status : undefined,
        });
        if (!res.success) {
          setError(res.error);
          return;
        }
      }

      if (editorDirty) {
        const res = await saveBlogContent(post.id, tenantSlug, {
          content: current.markdown,
          contentJson: current.json,
          rescore: true,
        });
        if (!res.success) {
          setError(res.error);
          return;
        }
        setSaveNotice(
          res.contentScore != null
            ? `Saved · v${res.versionNumber} · score ${res.contentScore}`
            : `Saved · v${res.versionNumber}`
        );
      } else {
        setSaveNotice("Saved");
      }

      setBaseline({
        title,
        metaDescription,
        status,
        contentMarkdown: current.markdown,
      });
      setEditorState(null);
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete "${post.title}"? This can't be undone.`))
      return;
    startDelete(async () => {
      const res = await deleteBlogPost(post.id, tenantSlug);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push("/seo-tracker/blog-writer");
      router.refresh();
    });
  };

  const handleBack = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    router.push("/seo-tracker/blog-writer");
  };

  const pendingFeedback = feedback.filter((f) => f.status === "pending").length;

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleBack}
            className="text-text-muted hover:text-foreground p-1.5 -ml-1.5 rounded-md hover:bg-sidebar"
            aria-label="Back to blog list"
          >
            <ArrowLeft size={18} />
          </button>
          <Link
            href="/seo-tracker/blog-writer"
            className="text-text-muted hover:text-foreground text-sm"
          >
            Blog posts
          </Link>
          <span className="text-text-muted text-sm">/</span>
          <h1 className="text-foreground font-semibold text-lg truncate">
            {title || "Untitled draft"}
          </h1>
          {dirty && (
            <span
              className="w-2 h-2 rounded-full bg-primary-500 shrink-0"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            />
          )}
          {post.contentScore != null && (
            <Badge
              variant={
                post.contentScore >= 90
                  ? "published"
                  : post.contentScore >= 80
                    ? "approved"
                    : "draft_status"
              }
            >
              {post.contentScore}/100
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isSaving || isDeleting}
            className="text-red-500 hover:text-red-600"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || isSaving || isDeleting}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Body: main editor + sticky sidebar */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Main — scrolls with the page */}
        <div className="space-y-4 min-w-0">
          <div className="grid md:grid-cols-[1fr_220px] gap-4">
            <div>
              <Label htmlFor="bp-title">Title</Label>
              <Input
                id="bp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSaving || isDeleting}
              />
            </div>
            <div>
              <Label htmlFor="bp-status">Status</Label>
              <select
                id="bp-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as BlogPostStatus)}
                disabled={isSaving || isDeleting}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground capitalize"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="bp-meta">
              Meta description ({metaDescription.length}/160)
            </Label>
            <Textarea
              id="bp-meta"
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              rows={2}
              disabled={isSaving || isDeleting}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Content · {current.wordCount} words</Label>
              {post.contentJson == null && (
                <span className="text-[10px] text-primary-500">
                  Upgrading to rich editor…
                </span>
              )}
            </div>
            <TiptapEditor
              initialJson={initialJson}
              initialMarkdown={post.content}
              placeholder="Start writing. Markdown shortcuts work: ## heading, - list, > quote…"
              disabled={isSaving || isDeleting}
              onChange={setEditorState}
            />
          </div>

          {post.targetKeyword && (
            <p className="text-xs text-text-muted">
              Target:{" "}
              <span className="text-foreground">{post.targetKeyword}</span>
              {post.secondaryKeywords.length > 0 && (
                <>
                  {" · Secondary: "}
                  {post.secondaryKeywords.join(", ")}
                </>
              )}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
          {saveNotice && !error && (
            <p className="text-xs text-status-green" role="status">
              {saveNotice}
            </p>
          )}
        </div>

        {/* Sticky right sidebar — feedback dock + drawers for
           history/older-feedback stay docked as the main content
           scrolls. `top-4` keeps the dock visible below the app
           header; `max-h-[calc(100vh-2rem)]` prevents overflow. */}
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border/30">
              <h3 className="text-foreground font-semibold text-sm">
                Feedback & regenerate
              </h3>
              <p className="text-[11px] text-text-muted mt-0.5">
                Type or talk while scanning · Save stashes, Regenerate rewrites.
              </p>
            </div>
            <InlineFeedbackDock
              postId={post.id}
              tenantSlug={tenantSlug}
              onAfterAction={() => router.refresh()}
            />
          </div>

          {/* Past feedback + versions collapse to drawers — they're
              useful but shouldn't crowd the sticky column. */}
          <Drawer
            label="Past feedback"
            count={feedback.length}
            pendingCount={pendingFeedback}
            open={showFeedbackHistory}
            onToggle={() => setShowFeedbackHistory((v) => !v)}
          >
            {feedback.length === 0 ? (
              <p className="text-xs text-text-muted px-4 py-3">
                No feedback yet.
              </p>
            ) : (
              <FeedbackPanel
                postId={post.id}
                tenantSlug={tenantSlug}
                feedback={feedback}
                onApplied={() => router.refresh()}
              />
            )}
          </Drawer>

          <Drawer
            label="Version history"
            count={versions.length}
            open={showVersions}
            onToggle={() => setShowVersions((v) => !v)}
            icon={<HistoryIcon size={13} />}
          >
            <VersionHistory
              postId={post.id}
              tenantSlug={tenantSlug}
              versions={versions}
              currentMarkdown={current.markdown}
              onReverted={() => {
                setEditorState(null);
                router.refresh();
              }}
            />
          </Drawer>
        </aside>
      </div>
    </div>
  );
}

function Drawer({
  label,
  count,
  pendingCount,
  open,
  onToggle,
  children,
  icon,
}: {
  label: string;
  count: number;
  pendingCount?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-foreground hover:bg-sidebar/40"
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
          <span className="text-[10px] text-text-muted">({count})</span>
          {pendingCount != null && pendingCount > 0 && (
            <span className="text-[10px] text-primary-500">
              · {pendingCount} pending
            </span>
          )}
        </span>
        <span className="text-text-muted text-xs">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="border-t border-border/30">{children}</div>}
    </div>
  );
}
