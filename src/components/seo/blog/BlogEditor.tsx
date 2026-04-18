"use client";

// WYSIWYG blog editor. Replaces the Phase A/B BlogPostEditor which
// used a plain markdown textarea. Three tabs: the writing surface,
// the feedback loop (text/voice), and version history (diff + revert).
//
// Save flow:
//   TiptapEditor.onChange           → local { json, markdown, wordCount }
//   Save button                     → saveBlogContent (rescore default)
//                                     which also writes a blog_post_versions row
//   router.refresh()                → page server component re-fetches
//                                     versions + feedback so tabs stay live

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/Badge";
import { TiptapEditor, type TiptapChange } from "./TiptapEditor";
import { FeedbackPanel } from "./FeedbackPanel";
import { VersionHistory } from "./VersionHistory";
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

type Tab = "editor" | "feedback" | "history";

interface Props {
  post: BlogPostRecord;
  tenantSlug: string;
  versions: BlogPostVersionRecord[];
  feedback: BlogPostFeedbackRecord[];
  onClose: () => void;
}

export function BlogEditor({
  post,
  tenantSlug,
  versions,
  feedback,
  onClose,
}: Props) {
  const router = useRouter();

  const [title, setTitle] = useState(post.title);
  const [metaDescription, setMetaDescription] = useState(
    post.metaDescription ?? ""
  );
  const [status, setStatus] = useState<BlogPostStatus>(post.status);

  // Editor state is a snapshot emitted by TiptapEditor.onChange. On
  // first mount, before any keystroke, we fall back to post.content
  // and post.contentJson so the save button can work even if the
  // user never typed anything.
  const initialJson = useMemo<JSONContent | null>(
    () => (post.contentJson as JSONContent | null) ?? null,
    [post.contentJson]
  );
  const [editorState, setEditorState] = useState<TiptapChange | null>(null);

  // Baseline = last-saved snapshot. Dirty is compared against this,
  // not against `post` props — router.refresh() is async and tiptap-
  // markdown's initial parse can fire an onUpdate that leaves
  // editorState non-null even when content hasn't actually changed.
  // Comparing by value keeps Save correctly disabled.
  const [baseline, setBaseline] = useState(() => ({
    title: post.title,
    metaDescription: post.metaDescription ?? "",
    status: post.status,
    contentMarkdown: post.content,
  }));

  const [tab, setTab] = useState<Tab>("editor");
  const [isSaving, startSave] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

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

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const handleSave = () => {
    setError(null);
    setSaveNotice(null);
    startSave(async () => {
      // Title / meta / status don't route through saveBlogContent —
      // keep the scoring-triggering action focused on content.
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

      // Snapshot what we just persisted so the dirty flags reset
      // cleanly — see comment on `baseline` state.
      setBaseline({
        title,
        metaDescription,
        status,
        contentMarkdown: current.markdown,
      });
      setEditorState(null);
      router.refresh();
      // Leave the modal open so the user can see the updated score +
      // keep editing. They close when they're done.
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
      onClose();
      router.refresh();
    });
  };

  const pendingFeedback = feedback.filter((f) => f.status === "pending").length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-card w-full md:max-w-[1100px] md:rounded-2xl border border-border flex flex-col max-h-screen">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-foreground font-semibold truncate">
              {title || "Untitled draft"}
            </h2>
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
                  post.contentScore >= 80 ? "published" : "draft_status"
                }
              >
                {post.contentScore}/100
              </Badge>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 border-b border-border/30 flex items-center gap-1 overflow-x-auto">
          <TabButton active={tab === "editor"} onClick={() => setTab("editor")}>
            Editor
          </TabButton>
          <TabButton
            active={tab === "feedback"}
            onClick={() => setTab("feedback")}
          >
            Feedback
            {pendingFeedback > 0 && (
              <span className="ml-1.5 text-[10px] text-primary-500">
                ({pendingFeedback})
              </span>
            )}
          </TabButton>
          <TabButton
            active={tab === "history"}
            onClick={() => setTab("history")}
          >
            History
            <span className="ml-1.5 text-[10px] text-text-muted">
              ({versions.length})
            </span>
          </TabButton>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {tab === "editor" && (
            <>
              <div className="grid md:grid-cols-[1fr_260px] gap-4">
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
                    onChange={(e) =>
                      setStatus(e.target.value as BlogPostStatus)
                    }
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
                  <span className="text-foreground">
                    {post.targetKeyword}
                  </span>
                  {post.secondaryKeywords.length > 0 && (
                    <>
                      {" · Secondary: "}
                      {post.secondaryKeywords.join(", ")}
                    </>
                  )}
                </p>
              )}
            </>
          )}

          {tab === "feedback" && (
            <FeedbackPanel
              postId={post.id}
              tenantSlug={tenantSlug}
              feedback={feedback}
              onApplied={() => router.refresh()}
            />
          )}

          {tab === "history" && (
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

        {/* Footer */}
        <div className="p-5 border-t border-border/30 flex items-center justify-between gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isSaving || isDeleting}
            className="text-red-500 hover:text-red-600"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isSaving || isDeleting}
            >
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={!dirty || isSaving || isDeleting}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2.5 text-sm border-b-2 transition-colors ${
        active
          ? "border-primary-500 text-foreground font-medium"
          : "border-transparent text-text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
