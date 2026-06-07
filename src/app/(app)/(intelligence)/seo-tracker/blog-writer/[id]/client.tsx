"use client";

// Full-page blog editor. Replaces the Phase D modal so the user can
// scan the post naturally while a sticky feedback/regenerate dock
// stays pinned on the right. Back button returns to the list.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import { ArrowLeft, History as HistoryIcon, Share2, Rocket, CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/Badge";
import { ImageUploadField } from "@/components/seo/blog/ImageUploadField";
import { publishBlogToGruve } from "@/lib/actions/publish-to-gruve";
import { TiptapEditor, type TiptapChange } from "@/components/seo/blog/TiptapEditor";
import { InlineFeedbackDock } from "@/components/seo/blog/InlineFeedbackDock";
import { VersionHistory } from "@/components/seo/blog/VersionHistory";
import { FeedbackPanel } from "@/components/seo/blog/FeedbackPanel";
import { DistributeDialog } from "@/components/seo/blog/DistributeDialog";
import { AskCoachButton } from "@/components/seo/blog/AskCoachButton";
import { SeoPanel } from "@/components/seo/blog/SeoPanel";
import { SeoPreviewPane } from "@/components/seo/blog/SeoPreviewPane";
import { scoreSeoExtras } from "@/lib/ai/seo/score-seo-extras";
import { useDialogs } from "@/components/ui/Dialog";
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
import type { ContentDistributionRecord } from "@/lib/types/content-distributions";

const STATUS_OPTIONS: BlogPostStatus[] = [
  "draft",
  "editing",
  "review",
  "published",
  "archived",
];

// Gruve's event categories — used for the blog `category` (drives breadcrumbs
// and links the post to its /categories landing page on Gruve).
const GRUVE_CATEGORIES = [
  "business", "religious", "comedy", "tech", "food_drinks", "crypto",
  "education", "healthcare", "sports_fitness", "music", "seminars",
  "visual_art", "community", "fashion", "media", "travel", "politics",
  "home", "school", "charity_fund",
];

function toDateInput(v: string | null): string {
  if (!v) return "";
  // ISO/timestamptz → yyyy-mm-dd for <input type=date>.
  return v.slice(0, 10);
}

export function BlogEditorPageClient({
  post,
  tenantSlug,
  versions,
  feedback,
  distributions,
  profileDefaults,
}: {
  post: BlogPostRecord;
  tenantSlug: string;
  versions: BlogPostVersionRecord[];
  feedback: BlogPostFeedbackRecord[];
  distributions: ContentDistributionRecord[];
  profileDefaults?: { author: string | null; authorImage: string | null };
}) {
  const router = useRouter();
  const dialogs = useDialogs();

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

  // Publish-to-Gruve fields (required by Contentful's gruveBlog content type).
  const [question, setQuestion] = useState(post.question ?? "");
  // Author fields fall back to the signed-in user's profile when the post
  // hasn't set them yet, so the avatar/name start filled.
  const [author, setAuthor] = useState(post.author ?? profileDefaults?.author ?? "");
  const [authorImage, setAuthorImage] = useState<string | null>(
    post.authorImage ?? profileDefaults?.authorImage ?? null
  );
  const [coverImage, setCoverImage] = useState<string | null>(post.coverImage?.url ?? null);
  const [thumbnail, setThumbnail] = useState<string | null>(post.thumbnail?.url ?? null);

  // SEO / E-E-A-T fields (slice 2).
  const [tags, setTags] = useState((post.tags ?? []).join(", "));
  const [category, setCategory] = useState(post.category ?? "");
  const [authorBio, setAuthorBio] = useState(post.authorBio ?? "");
  const [authorTitle, setAuthorTitle] = useState(post.authorTitle ?? "");
  const [authorUrl, setAuthorUrl] = useState(post.authorUrl ?? "");
  const [publishedDate, setPublishedDate] = useState(toDateInput(post.publishedDate));
  const [updatedDate, setUpdatedDate] = useState(toDateInput(post.updatedDate));
  const [noindex, setNoindex] = useState(Boolean(post.noindex));
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [isSaving, startSave] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [isPublishing, startPublish] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<{ gammaUrl: string; liveUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showDistribute, setShowDistribute] = useState(false);

  const distributionsReady = distributions.length > 0;
  const distributionsApproved = distributions.filter(
    (d) => d.status === "approved"
  ).length;

  const current = {
    markdown: editorState?.markdown ?? post.content,
    json: editorState?.json ?? initialJson,
    wordCount: editorState?.wordCount ?? post.wordCount,
  };

  // SEO signals recomputed on every editor change. Deterministic text
  // analysis only — no AI cost, O(post-length) on the client. SERP
  // context (avg word count, top domains) wires in via a future server
  // prefetch; passed as null until then.
  //
  // No dedicated seo_meta_title input yet; the H1/title doubles as the
  // SEO title until we ship a separate input. Migration 043 adds
  // seo_meta_title on blog_posts for the generator to write to; once a
  // Meta-title input lands in the UI, swap this.
  const seoExtras = useMemo(
    () =>
      scoreSeoExtras({
        seoMetaTitle: title || null,
        seoMetaDescription: metaDescription || null,
        bodyMarkdown: current.markdown ?? "",
        jsonLdBlocks: [],
        serpAvgWordCount: null,
        serpTopDomains: [],
      }),
    [title, metaDescription, current.markdown]
  );

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

  const handleDelete = async () => {
    const ok = await dialogs.confirm({
      title: `Delete "${post.title}"?`,
      subtitle:
        "This blog post and all its versions will be permanently removed. You can't undo this.",
      tone: "destructive",
      confirmLabel: "Delete post",
    });
    if (!ok) return;
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

  const handleBack = async () => {
    if (dirty) {
      const ok = await dialogs.confirm({
        title: "Discard unsaved changes?",
        subtitle:
          "Your edits to the title, meta, or content haven't been saved yet. Leaving now will lose them.",
        tone: "warning",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }
    router.push("/seo-tracker/blog-writer");
  };

  // Image fields persist immediately (they're already uploaded to storage —
  // we just save the resulting URL so the server has it at publish time).
  const onCover = (url: string | null) => {
    setCoverImage(url);
    void updateBlogPost(post.id, tenantSlug, { coverImage: url ? { url } : null });
  };
  const onThumb = (url: string | null) => {
    setThumbnail(url);
    void updateBlogPost(post.id, tenantSlug, { thumbnail: url ? { url } : null });
  };
  const onAuthorImg = (url: string | null) => {
    setAuthorImage(url);
    void updateBlogPost(post.id, tenantSlug, { authorImage: url });
  };

  const requirements = [
    { label: "Title", ok: title.trim().length > 0 },
    { label: "URL slug", ok: Boolean(post.slug) },
    { label: "Body content", ok: (current.wordCount ?? 0) > 0 },
    { label: "Question / hook", ok: question.trim().length > 0 },
    { label: "Banner image", ok: Boolean(coverImage) },
    { label: "Thumbnail", ok: Boolean(thumbnail) },
    { label: "Author name", ok: author.trim().length > 0 },
    { label: "Author image", ok: Boolean(authorImage) },
  ];
  const readyToPublish = requirements.every((r) => r.ok);

  // All editor-collected fields beyond title/meta/content/status, persisted
  // together (publish reads them from the DB).
  const detailsPatch = () => ({
    question,
    author,
    // Include authorImage so a profile-defaulted avatar (never re-uploaded)
    // still gets persisted on save/publish.
    authorImage,
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    category: category || null,
    authorBio: authorBio || null,
    authorTitle: authorTitle || null,
    authorUrl: authorUrl || null,
    publishedDate: publishedDate || null,
    updatedDate: updatedDate || null,
    noindex,
  });

  const handleSaveDetails = () => {
    setError(null);
    setDetailsSaved(false);
    startSave(async () => {
      const res = await updateBlogPost(post.id, tenantSlug, detailsPatch());
      if (!res.success) {
        setError(res.error);
        return;
      }
      setDetailsSaved(true);
      router.refresh();
    });
  };

  const handlePublish = () => {
    setPublishError(null);
    setPublishResult(null);
    startPublish(async () => {
      // Persist all editor fields first so the server sees them.
      const saved = await updateBlogPost(post.id, tenantSlug, detailsPatch());
      if (!saved.success) {
        setPublishError(saved.error);
        return;
      }
      const res = await publishBlogToGruve(post.id);
      if (!res.success) {
        setPublishError(res.error);
        return;
      }
      setPublishResult({ gammaUrl: res.gammaUrl, liveUrl: res.liveUrl });
      router.refresh();
    });
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
            variant="ghost"
            size="sm"
            onClick={() => setShowDistribute(true)}
            disabled={isSaving || isDeleting}
            className="gap-1.5"
            title={
              distributionsReady
                ? `${distributionsApproved} approved · ${distributions.length} drafts`
                : "Turn this post into 8 channel artifacts"
            }
          >
            <Share2 size={14} />
            Distribute
            {distributionsReady && (
              <span className="ml-0.5 text-[10px] px-1 rounded-full bg-primary-500/10 text-primary-500">
                {distributions.length}
              </span>
            )}
          </Button>
          <AskCoachButton
            tenantSlug={tenantSlug}
            blogPostId={post.id}
            disabled={isSaving || isDeleting}
          />
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || isSaving || isDeleting}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <DistributeDialog
        open={showDistribute}
        onClose={() => {
          setShowDistribute(false);
          router.refresh();
        }}
        tenantSlug={tenantSlug}
        blogPostId={post.id}
        initial={distributions}
      />

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
          {/* SEO signals — supplementary to the rubric ScoreBreakdown,
              live-updated as the user edits. Phase 1 of the SEO module. */}
          <SeoPanel extras={seoExtras} />

          {/* Live preview on Gruve (SEO module §13, milestone M2). */}
          <SeoPreviewPane postId={post.id} />

          {/* SEO & author details (slice 2) — Article schema, E-E-A-T,
              internal linking. Persisted via "Save details" and on publish. */}
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border/30">
              <h3 className="text-foreground font-semibold text-sm">SEO &amp; author details</h3>
              <p className="text-[11px] text-text-muted mt-0.5">
                Strengthens Article schema, E‑E‑A‑T &amp; internal linking.
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <Label htmlFor="bp-tags">Tags / keywords (comma-separated)</Label>
                <Input
                  id="bp-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="lagos events, raves, nightlife"
                  disabled={isSaving}
                />
              </div>
              <div>
                <Label htmlFor="bp-category">Category</Label>
                <select
                  id="bp-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={isSaving}
                  className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground capitalize"
                >
                  <option value="">— none —</option>
                  {GRUVE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="bp-authortitle">Author title</Label>
                  <Input
                    id="bp-authortitle"
                    value={authorTitle}
                    onChange={(e) => setAuthorTitle(e.target.value)}
                    placeholder="Events Editor"
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <Label htmlFor="bp-authorurl">Author URL</Label>
                  <Input
                    id="bp-authorurl"
                    value={authorUrl}
                    onChange={(e) => setAuthorUrl(e.target.value)}
                    placeholder="https://…"
                    disabled={isSaving}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="bp-authorbio">Author bio</Label>
                <Textarea
                  id="bp-authorbio"
                  value={authorBio}
                  onChange={(e) => setAuthorBio(e.target.value)}
                  rows={2}
                  placeholder="Short author bio — feeds Person schema (E‑E‑A‑T)."
                  disabled={isSaving}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="bp-pubdate">Published</Label>
                  <Input
                    id="bp-pubdate"
                    type="date"
                    value={publishedDate}
                    onChange={(e) => setPublishedDate(e.target.value)}
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <Label htmlFor="bp-upddate">Updated</Label>
                  <Input
                    id="bp-upddate"
                    type="date"
                    value={updatedDate}
                    onChange={(e) => setUpdatedDate(e.target.value)}
                    disabled={isSaving}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-foreground">
                <input
                  type="checkbox"
                  checked={noindex}
                  onChange={(e) => setNoindex(e.target.checked)}
                  disabled={isSaving}
                />
                Hide from search engines (noindex)
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={handleSaveDetails}
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : "Save details"}
              </Button>
              {detailsSaved && (
                <p className="text-[11px] text-status-green">Details saved.</p>
              )}
            </div>
          </div>

          {/* Publish to Gruve — collects the Contentful-required fields
              (banner, thumbnail, author + avatar, question) and gates the
              push until everything's present. Publishing lands on both
              gamma.gruve.events and www.gruve.events (shared Contentful). */}
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border/30">
              <h3 className="text-foreground font-semibold text-sm flex items-center gap-1.5">
                <Rocket size={14} /> Publish to Gruve
              </h3>
              <p className="text-[11px] text-text-muted mt-0.5">
                Goes live on gamma + www (both read the same Contentful).
              </p>
            </div>
            <div className="p-4 space-y-4">
              <ImageUploadField
                label="Banner image"
                required
                kind="banner"
                value={coverImage}
                tenantSlug={tenantSlug}
                postId={post.id}
                disabled={isPublishing}
                onChange={onCover}
                hint="Hero / social (OG) image · 16:9."
              />
              <ImageUploadField
                label="Thumbnail"
                required
                kind="thumbnail"
                value={thumbnail}
                tenantSlug={tenantSlug}
                postId={post.id}
                disabled={isPublishing}
                onChange={onThumb}
                hint="Card image on the blog index."
              />
              <div>
                <Label htmlFor="bp-question">Question / hook *</Label>
                <Input
                  id="bp-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="The sub-heading / FAQ-style hook"
                  disabled={isPublishing}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                <div>
                  <Label htmlFor="bp-author">Author *</Label>
                  <Input
                    id="bp-author"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Author name"
                    disabled={isPublishing}
                  />
                </div>
                <ImageUploadField
                  label="Avatar"
                  required
                  kind="author"
                  aspect="square"
                  value={authorImage}
                  tenantSlug={tenantSlug}
                  postId={post.id}
                  disabled={isPublishing}
                  onChange={onAuthorImg}
                />
              </div>

              <ul className="space-y-1 pt-1">
                {requirements.map((r) => (
                  <li key={r.label} className="flex items-center gap-2 text-[12px]">
                    {r.ok ? (
                      <CheckCircle2 size={13} className="text-status-green shrink-0" />
                    ) : (
                      <Circle size={13} className="text-text-muted shrink-0" />
                    )}
                    <span className={r.ok ? "text-foreground" : "text-text-muted"}>
                      {r.label}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                className="w-full gap-1.5"
                disabled={!readyToPublish || isPublishing || dirty}
                onClick={handlePublish}
              >
                <Rocket size={14} />
                {isPublishing ? "Publishing…" : "Push to Gruve"}
              </Button>
              {dirty && (
                <p className="text-[11px] text-text-muted">
                  Save your edits (top right) before publishing.
                </p>
              )}
              {publishError && (
                <p className="text-[12px] text-red-500" role="alert">
                  {publishError}
                </p>
              )}
              {publishResult && (
                <div className="text-[12px] space-y-1">
                  <p className="text-status-green font-medium">Published ✓</p>
                  <a
                    href={publishResult.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary-500 hover:underline"
                  >
                    <ExternalLink size={12} /> View live (www)
                  </a>
                  <a
                    href={publishResult.gammaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary-500 hover:underline"
                  >
                    <ExternalLink size={12} /> View on gamma
                  </a>
                </div>
              )}
            </div>
          </div>

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
              post={post}
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
