"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialogs } from "@/components/ui/Dialog";
import {
  abandonUploadSession,
  finalizeUpload,
  mintUploadSession,
} from "@/lib/actions/content-pipeline-upload";
import { createCustomContentType } from "@/lib/actions/content-pipeline";
import {
  generateLocalPreview,
  runResumableUpload,
} from "@/lib/upload/resumable-put";
import {
  CONTENT_PLATFORMS,
  type ContentPlatform,
  type ContentSection,
  type ContentType,
} from "@/lib/types/content-pipeline";
import { MenuSelect } from "./MenuSelect";

const CREATE_TYPE_SENTINEL = "__create__";

interface ItemDraft {
  fileKey: string;
  file: File;
  preview: string | null;
  // metadata
  title: string;
  contentTypeSlug: string | null;
  platforms: ContentPlatform[];
  scheduledAt: string;
  assignedTo: string | null;
  // upload state
  uploadState: "queued" | "uploading" | "uploaded" | "failed";
  progress: number;
  error?: string;
  sessionId?: string;
  driveFileId?: string;
  driveMimeType?: string;
  driveSizeBytes?: number;
  driveWebViewLink?: string;
  thumbnailLink?: string;
}

interface Props {
  tenantSlug: string;
  sections: ContentSection[];
  contentTypes: ContentType[];
  members: Array<{ id: string; name: string; avatarUrl: string | null }>;
  activeSectionSlug: string;
  onClose: () => void;
  /** Called when the user creates a new content type from inside this
   * modal so the parent can keep table/filter dropdowns in sync. */
  onTypeCreated?: (type: ContentType) => void;
}

const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  email: "Email",
};

function filenameToTitle(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UploadModal({
  tenantSlug,
  sections,
  contentTypes,
  members,
  activeSectionSlug,
  onClose,
  onTypeCreated,
}: Props) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const sectionSlug = activeSectionSlug;
  const [phase, setPhase] = useState<"select" | "metadata" | "uploading" | "done">(
    "select"
  );
  // When on, edits to the active draft propagate to every other
  // draft (except per-file fields like title). The footer also
  // surfaces an "Upload all" CTA so the user can skip the per-file
  // walk entirely. Toggling ON also retroactively pushes the
  // active draft's broadcastable fields to every other draft, so
  // a user who set up file #1 and then toggled doesn't have to
  // re-enter values.
  const [applyToAll, setApplyToAllState] = useState(false);
  const setApplyToAll = (next: boolean) => {
    setApplyToAllState(next);
    if (!next) return;
    setDrafts((prev) => {
      const active = prev[activeIdx];
      if (!active) return prev;
      const broadcast = {
        contentTypeSlug: active.contentTypeSlug,
        platforms: active.platforms,
        scheduledAt: active.scheduledAt,
        assignedTo: active.assignedTo,
      };
      return prev.map((d, i) => (i === activeIdx ? d : { ...d, ...broadcast }));
    });
  };
  // Local mirror of contentTypes — the upload modal can add to this
  // list via the inline "Create new type" affordance. Parent gets
  // notified via onTypeCreated.
  const [types, setTypes] = useState(contentTypes);
  // Inline create-type panel state. Holds the draft index whose
  // type field opened the prompt; on save the new slug is applied
  // to that draft (and broadcast if applyToAll is on).
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [newTypeBusy, setNewTypeBusy] = useState(false);
  const [newTypeError, setNewTypeError] = useState<string | null>(null);
  // Files the user has actually visited in the stepper. Drives the
  // "✓" check in the sidebar so a 20-file batch shows progress.
  // Active row is always treated as visited too.
  const [visitedKeys, setVisitedKeys] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Mark drafts visited as the user navigates. Always include the
  // active draft.
  useEffect(() => {
    if (!drafts[activeIdx]) return;
    const key = drafts[activeIdx].fileKey;
    setVisitedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [activeIdx, drafts]);

  // Block tab close mid-upload
  useEffect(() => {
    if (phase !== "uploading") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  const onFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const next: ItemDraft[] = [];
    for (const f of files) {
      next.push({
        fileKey: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`,
        file: f,
        preview: await generateLocalPreview(f),
        title: filenameToTitle(f.name),
        contentTypeSlug: null,
        platforms: [],
        scheduledAt: "",
        assignedTo: null,
        uploadState: "queued",
        progress: 0,
      });
    }
    setDrafts((prev) => [...prev, ...next]);
    if (next.length > 0) setPhase("metadata");
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  };

  // Fields that should NEVER broadcast even when applyToAll is on —
  // each file owns its own copy (e.g. title comes from the filename).
  const PER_FILE_FIELDS: Array<keyof ItemDraft> = [
    "fileKey",
    "file",
    "preview",
    "title",
    "uploadState",
    "progress",
    "error",
    "sessionId",
    "driveFileId",
    "driveMimeType",
    "driveSizeBytes",
    "driveWebViewLink",
    "thumbnailLink",
  ];

  const updateDraft = (idx: number, patch: Partial<ItemDraft>) => {
    setDrafts((prev) => {
      if (!applyToAll) {
        return prev.map((d, i) => (i === idx ? { ...d, ...patch } : d));
      }
      // Strip per-file fields from the broadcast copy.
      const broadcast: Partial<ItemDraft> = { ...patch };
      for (const k of PER_FILE_FIELDS) {
        delete broadcast[k as keyof typeof broadcast];
      }
      return prev.map((d, i) =>
        i === idx ? { ...d, ...patch } : { ...d, ...broadcast }
      );
    });
  };

  const togglePlatform = (idx: number, p: ContentPlatform) => {
    setDrafts((prev) => {
      const active = prev[idx];
      if (!active) return prev;
      const has = active.platforms.includes(p);
      const next = has
        ? active.platforms.filter((x) => x !== p)
        : [...active.platforms, p];
      if (!applyToAll) {
        return prev.map((d, i) => (i === idx ? { ...d, platforms: next } : d));
      }
      return prev.map((d) => ({ ...d, platforms: next }));
    });
  };

  const handleTypeSelect = (idx: number, value: string) => {
    if (value === CREATE_TYPE_SENTINEL) {
      setNewTypeLabel("");
      setNewTypeError(null);
      setCreatingFor(idx);
      return;
    }
    updateDraft(idx, { contentTypeSlug: value || null });
  };

  const submitNewType = async () => {
    if (!newTypeLabel.trim() || creatingFor === null) return;
    setNewTypeBusy(true);
    setNewTypeError(null);
    const res = await createCustomContentType(newTypeLabel);
    setNewTypeBusy(false);
    if (!res.ok) {
      setNewTypeError(res.error);
      return;
    }
    const created: ContentType = {
      tenantSlug,
      slug: res.data.slug,
      label: res.data.label,
      isDefault: false,
      createdBy: null,
    };
    setTypes((prev) =>
      [...prev, created].sort((a, b) => a.label.localeCompare(b.label))
    );
    onTypeCreated?.(created);
    updateDraft(creatingFor, { contentTypeSlug: created.slug });
    setCreatingFor(null);
    setNewTypeLabel("");
  };

  const cancelNewType = () => {
    setCreatingFor(null);
    setNewTypeLabel("");
    setNewTypeError(null);
  };

  const startUploads = async () => {
    setPhase("uploading");
    // Run uploads sequentially to keep Drive's per-user quota happy
    // and to give a clean progress UX. Could parallelize 2-at-a-time
    // later if it becomes a bottleneck.
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (d.uploadState === "uploaded") continue;

      updateDraft(i, { uploadState: "uploading", progress: 0, error: undefined });

      const minted = await mintUploadSession({
        filename: d.file.name,
        mimeType: d.file.type || "application/octet-stream",
        sizeBytes: d.file.size,
        sectionSlug,
      });
      if (!minted.ok) {
        updateDraft(i, { uploadState: "failed", error: minted.error });
        continue;
      }

      try {
        const result = await runResumableUpload({
          uri: minted.uri,
          file: d.file,
          sessionId: minted.sessionId,
          onProgress: (uploaded, total) => {
            updateDraft(i, { progress: Math.round((uploaded / total) * 100) });
          },
        });

        const finalized = await finalizeUpload({
          sessionId: minted.sessionId,
          driveFileId: result.driveFileId,
          driveMimeType: result.driveMimeType,
          driveSizeBytes: result.driveSizeBytes,
          driveWebViewLink: result.driveWebViewLink ?? null,
          thumbnailLink: result.thumbnailLink ?? null,
          // Browser-extracted preview — image OR video frame. Becomes
          // the table thumbnail. Falls back to Drive's thumbnailLink
          // server-side if null.
          localThumbnailDataUrl: d.preview ?? null,
          title: d.title,
          contentTypeSlug: d.contentTypeSlug,
          platforms: d.platforms,
          scheduledAt: d.scheduledAt
            ? new Date(d.scheduledAt).toISOString()
            : null,
          assignedTo: d.assignedTo,
        });
        if (!finalized.ok) {
          updateDraft(i, {
            uploadState: "failed",
            error: finalized.error,
          });
        } else {
          updateDraft(i, {
            uploadState: "uploaded",
            progress: 100,
            sessionId: minted.sessionId,
            driveFileId: result.driveFileId,
            driveMimeType: result.driveMimeType,
            driveSizeBytes: result.driveSizeBytes,
            driveWebViewLink: result.driveWebViewLink,
            thumbnailLink: result.thumbnailLink,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        await abandonUploadSession(minted.sessionId);
        updateDraft(i, { uploadState: "failed", error: message });
      }
    }
    setPhase("done");
    router.refresh();
  };

  const close = async () => {
    if (phase === "uploading") {
      const ok = await dialogs.confirm({
        title: "Cancel uploads?",
        subtitle:
          "In-progress files will stop. Files already uploaded to Drive will remain.",
        confirmLabel: "Stop",
        tone: "destructive",
      });
      if (!ok) return;
    }
    onClose();
  };

  const allUploaded =
    drafts.length > 0 && drafts.every((d) => d.uploadState === "uploaded");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* In the metadata phase the modal needs a DEFINITE height so
       * `flex-1` body + `h-full` panel + `overflow-y-auto` sidebar
       * resolve into a bounded, scrollable region. In select/upload/
       * done phases the content is short, so the modal sizes to its
       * content (capped at max-h) and avoids a sea of empty space. */}
      <div
        className={`bg-card border border-border rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden ${
          phase === "metadata"
            ? "h-[95vh] md:h-[90vh]"
            : "max-h-[95vh] md:max-h-[90vh]"
        }`}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-lg font-semibold text-foreground truncate">
              Upload content
            </h2>
            {/* Position counter — only meaningful for batches, lives in
             * the header so the footer can stay focused on actions. */}
            {phase === "metadata" && drafts.length > 1 ? (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400 tabular-nums flex-shrink-0">
                {activeIdx + 1} / {drafts.length}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            className="p-1 rounded-md text-text-muted hover:text-foreground flex-shrink-0"
          >
            <X size={18} />
          </button>
        </header>

        <div
          className={`flex-1 p-5 min-h-0 ${
            phase === "metadata"
              ? "overflow-y-auto md:overflow-hidden"
              : "overflow-y-auto"
          }`}
        >
          {phase === "select" ? (
            <DropZone
              fileInputRef={fileInputRef}
              dragActive={dragActive}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onPick={() => fileInputRef.current?.click()}
              onPickedFiles={onFiles}
            />
          ) : null}

          {phase === "metadata" && drafts.length > 0 ? (
            <MetadataPanel
              drafts={drafts}
              activeIdx={activeIdx}
              setActiveIdx={setActiveIdx}
              contentTypes={types}
              members={members}
              updateDraft={updateDraft}
              togglePlatform={togglePlatform}
              onTypeSelect={handleTypeSelect}
              creatingFor={creatingFor}
              newTypeLabel={newTypeLabel}
              setNewTypeLabel={setNewTypeLabel}
              newTypeBusy={newTypeBusy}
              newTypeError={newTypeError}
              submitNewType={submitNewType}
              cancelNewType={cancelNewType}
              visitedKeys={visitedKeys}
              applyToAll={applyToAll}
              setApplyToAll={setApplyToAll}
            />
          ) : null}

          {(phase === "uploading" || phase === "done") && drafts.length > 0 ? (
            <UploadProgress drafts={drafts} />
          ) : null}
        </div>

        <footer className="border-t border-border px-5 py-3 flex items-center justify-between gap-3">
          {phase === "metadata" ? (
            <>
              {/* Left: stage-aware (Cancel on first, Back on others).
               * Back is rendered as a tertiary CTA so the visual
               * weight progresses left-to-right toward the primary
               * action. */}
              {activeIdx === 0 ? (
                <Button variant="tertiary" size="sm" onClick={close}>
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => setActiveIdx(activeIdx - 1)}
                >
                  <ChevronLeft size={14} className="mr-1" />
                  Back
                </Button>
              )}

              {/* Right: Next is the primary action (filled). When
               * "Apply to all" is on, Upload-all sits next to it as
               * the secondary (outlined) so it's visible but doesn't
               * compete for the eye. On the last file, the only
               * action is Upload — primary. Position counter lives in
               * the header badge so the footer stays tight. */}
              <div className="flex items-center gap-2 ml-auto">
                {activeIdx < drafts.length - 1 ? (
                  <>
                    {applyToAll && drafts.length > 1 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={startUploads}
                      >
                        <UploadIcon size={14} className="mr-1.5" />
                        Upload all
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={() => setActiveIdx(activeIdx + 1)}
                    >
                      Next
                      <ChevronRight size={14} className="ml-1" />
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={startUploads}>
                    <UploadIcon size={14} className="mr-1.5" />
                    Upload all
                  </Button>
                )}
              </div>
            </>
          ) : null}

          {phase === "select" ? (
            <>
              <span className="text-xs text-text-muted">
                Drag files in or click to pick
              </span>
              <Button variant="outline" size="sm" onClick={close}>
                Cancel
              </Button>
            </>
          ) : null}

          {phase === "uploading" ? (
            <>
              <span className="text-xs text-text-muted">
                Don&apos;t close this tab while uploading.
              </span>
              <span />
            </>
          ) : null}

          {phase === "done" ? (
            <>
              <span />
              <Button size="sm" onClick={close}>
                {allUploaded ? "Done" : "Close"}
              </Button>
            </>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

// ── Drop zone ────────────────────────────────────────────────

function DropZone({
  fileInputRef,
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
  onPickedFiles,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dragActive: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: () => void;
  onPickedFiles: (files: FileList) => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-full border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
        dragActive
          ? "border-primary-500 bg-primary-50/50"
          : "border-border hover:border-primary-400 hover:bg-gray-50 dark:hover:bg-gray-900/50"
      }`}
    >
      <UploadIcon
        size={28}
        className="text-text-muted mx-auto mb-3"
      />
      <p className="text-foreground font-medium mb-1">
        Drop files here, or click to browse
      </p>
      <p className="text-text-muted text-sm">
        Images and videos up to 2 GB. Goes straight to your Drive — Pulse
        tracks the metadata.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onPickedFiles(e.target.files);
        }}
      />
    </button>
  );
}

// ── Metadata panel ───────────────────────────────────────────

function MetadataPanel({
  drafts,
  activeIdx,
  setActiveIdx,
  contentTypes,
  members,
  updateDraft,
  togglePlatform,
  onTypeSelect,
  creatingFor,
  newTypeLabel,
  setNewTypeLabel,
  newTypeBusy,
  newTypeError,
  submitNewType,
  cancelNewType,
  visitedKeys,
  applyToAll,
  setApplyToAll,
}: {
  drafts: ItemDraft[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  contentTypes: ContentType[];
  members: Array<{ id: string; name: string; avatarUrl: string | null }>;
  updateDraft: (idx: number, patch: Partial<ItemDraft>) => void;
  togglePlatform: (idx: number, p: ContentPlatform) => void;
  onTypeSelect: (idx: number, value: string) => void;
  creatingFor: number | null;
  newTypeLabel: string;
  setNewTypeLabel: (v: string) => void;
  newTypeBusy: boolean;
  newTypeError: string | null;
  submitNewType: () => void;
  cancelNewType: () => void;
  visitedKeys: Set<string>;
  applyToAll: boolean;
  setApplyToAll: (v: boolean) => void;
}) {
  const active = drafts[activeIdx];
  // Refs to the active row in each list so we can scroll-into-view
  // exactly when activeIdx changes (NOT on every render — inline ref
  // callbacks re-fire on every render and were preventing the user
  // from manually scrolling the list).
  const desktopActiveRef = useRef<HTMLLIElement | null>(null);
  const mobileActiveRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    desktopActiveRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
    mobileActiveRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeIdx]);

  if (!active) return null;

  // Big-batch density: at 20+ files the row tightens slightly so
  // more fit without scrolling, but the thumb stays large enough to
  // recognize the media.
  const dense = drafts.length > 20;
  const visitedCount = visitedKeys.size;

  return (
    <div className="md:flex md:gap-5 md:h-full md:min-h-0">
      {/* Sidebar — scrolls as a single region so the visited indicator
       * stays visible at the top and the file list flows below it.
       * The simpler chain (one overflow region instead of nested flex)
       * is much more reliable across browsers. */}
      <aside className="mb-4 md:mb-0 md:w-[260px] md:flex-shrink-0 md:border-r md:border-border md:pr-4 md:overflow-y-auto md:h-full md:min-h-0">
        {/* Visited indicator — sticky on desktop so it stays at the top
         * of the scroll region. */}
        <div className="text-[11px] text-text-muted mb-2 tabular-nums md:sticky md:top-0 md:bg-card md:pb-1 md:z-10">
          {visitedCount}/{drafts.length} reviewed
        </div>

        {/* Mobile: horizontal scroll strip — thumbnails only, with
         * active ring + visited check overlay. Filenames hide because
         * they crush the layout on narrow screens. */}
        <ul className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x md:hidden">
          {drafts.map((d, i) => {
            const isActive = i === activeIdx;
            const isVisited = visitedKeys.has(d.fileKey);
            return (
              <li
                key={d.fileKey}
                className="flex-shrink-0 snap-start"
                ref={isActive ? mobileActiveRef : null}
              >
                <button
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  aria-label={d.file.name}
                  className={`relative w-16 h-16 rounded-lg overflow-hidden flex items-center justify-center bg-gray-100 dark:bg-gray-800 transition-shadow ${
                    isActive
                      ? "ring-2 ring-primary-500"
                      : "ring-1 ring-border"
                  }`}
                >
                  {d.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.preview}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UploadIcon size={20} className="text-text-muted" />
                  )}
                  {isVisited && !isActive ? (
                    <span className="absolute top-1 right-1 bg-card rounded-full leading-none">
                      <CheckCircle2
                        size={14}
                        className="text-status-green"
                      />
                    </span>
                  ) : null}
                  {isActive ? (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-card" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Desktop: vertical list with thumb + filename + status dot */}
        <ul
          className={`hidden md:block ${
            dense ? "space-y-px" : "space-y-1"
          } md:-mx-1 md:px-1 md:pb-2`}
        >
          {drafts.map((d, i) => {
            const isActive = i === activeIdx;
            const isVisited = visitedKeys.has(d.fileKey);
            const thumb = dense ? "w-10 h-10" : "w-12 h-12";
            return (
              <li
                key={d.fileKey}
                ref={isActive ? desktopActiveRef : null}
              >
                <button
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={`group w-full text-left rounded-md flex items-center gap-2.5 transition-colors ${
                    dense ? "px-1.5 py-1" : "px-2 py-1.5"
                  } ${
                    isActive
                      ? "bg-primary-50 text-foreground ring-1 ring-primary-200"
                      : "hover:bg-gray-100 dark:hover:bg-gray-900"
                  }`}
                >
                  <span
                    className={`${thumb} rounded-md bg-gray-100 dark:bg-gray-800 flex-shrink-0 overflow-hidden flex items-center justify-center`}
                  >
                    {d.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.preview}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UploadIcon
                        size={dense ? 14 : 16}
                        className="text-text-muted"
                      />
                    )}
                  </span>
                  <span className="truncate text-xs flex-1 min-w-0">
                    {d.file.name}
                  </span>
                  {/* Visited / active indicator — small status dot */}
                  <span className="flex-shrink-0">
                    {isActive ? (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-500" />
                    ) : isVisited ? (
                      <CheckCircle2
                        size={12}
                        className="text-status-green opacity-80"
                      />
                    ) : (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-700" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

      </aside>

      {/* Form — own scroll region on md+ so the sidebar bulk-apply
       * stays put when the form gets long. */}
      <div className="space-y-4 md:flex-1 md:overflow-y-auto md:min-h-0 md:pr-1">
        <div>
          <Label htmlFor="upload-title">Title</Label>
          <Input
            id="upload-title"
            value={active.title}
            onChange={(e) => updateDraft(activeIdx, { title: e.target.value })}
          />
        </div>

        <div>
          <Label>Platforms</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {CONTENT_PLATFORMS.map((p) => {
              const on = active.platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(activeIdx, p)}
                  className={`px-2.5 py-1 text-xs rounded-md ${
                    on
                      ? "bg-primary-500 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-text-muted hover:text-foreground"
                  }`}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Type + Target post date share a row; assignee gets its own */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="upload-type">Type</Label>
            <div className="mt-1">
              <MenuSelect
                id="upload-type"
                value={active.contentTypeSlug ?? ""}
                onChange={(v) => onTypeSelect(activeIdx, v)}
                options={contentTypes.map((t) => ({
                  value: t.slug,
                  label: t.label,
                }))}
                extra={{
                  value: CREATE_TYPE_SENTINEL,
                  label: "+ Create new type…",
                }}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="upload-scheduled">Post schedule</Label>
            {/* Native datetime-local: hide the webkit picker icon
             * outright (display:none reliably suppresses it where
             * opacity:0 alone left it visible in some webkit builds).
             * The custom calendar icon sits at the far-right padding
             * edge to align with the Type select's chevron, and a
             * click anywhere in the input opens the picker via
             * showPicker(). */}
            <div className="relative mt-1">
              <Input
                id="upload-scheduled"
                type="datetime-local"
                value={active.scheduledAt}
                onChange={(e) =>
                  updateDraft(activeIdx, { scheduledAt: e.target.value })
                }
                onClick={(e) => {
                  // showPicker is supported on Chrome/Safari/Firefox
                  // for datetime-local. Guard for older browsers.
                  const el = e.currentTarget as HTMLInputElement & {
                    showPicker?: () => void;
                  };
                  el.showPicker?.();
                }}
                className="pr-10 [&::-webkit-calendar-picker-indicator]:hidden"
              />
              <CalendarDays
                size={16}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="upload-assignee">Assigned to</Label>
          <div className="mt-1">
            <MenuSelect
              id="upload-assignee"
              value={active.assignedTo ?? ""}
              onChange={(v) =>
                updateDraft(activeIdx, { assignedTo: v || null })
              }
              options={members.map((m) => ({ value: m.id, label: m.name }))}
            />
          </div>
        </div>

        {/* Apply-to-all toggle — only meaningful for batches.
         * When on, edits to the active draft propagate to every
         * other draft (except per-file fields like title), and
         * the footer adds an "Upload all" CTA next to Next. */}
        {drafts.length > 1 ? (
          <label className="flex items-start gap-3 p-3 rounded-xl border border-border bg-gray-50/60 dark:bg-gray-900/30 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={applyToAll}
              onClick={() => setApplyToAll(!applyToAll)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors mt-0.5 ${
                applyToAll
                  ? "bg-primary-500"
                  : "bg-gray-300 dark:bg-gray-700"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  applyToAll ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="text-sm">
              <span className="text-foreground font-medium">
                Apply to all {drafts.length} files
              </span>
              <span className="block text-xs text-text-muted mt-0.5">
                Edits made here will sync to every other file in this
                batch (except titles).
              </span>
            </span>
          </label>
        ) : null}

        {creatingFor === activeIdx ? (
          <div className="p-3 rounded-lg border border-border bg-gray-50 dark:bg-gray-900/50">
            <Label htmlFor="new-type-label" className="text-xs">
              New type label
            </Label>
            <Input
              id="new-type-label"
              value={newTypeLabel}
              onChange={(e) => setNewTypeLabel(e.target.value)}
              placeholder="e.g. Behind the scenes"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNewType();
                } else if (e.key === "Escape") {
                  cancelNewType();
                }
              }}
            />
            {newTypeError ? (
              <p className="text-xs text-red-600 mt-1">{newTypeError}</p>
            ) : null}
            <div className="flex gap-2 mt-2 justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelNewType}
                disabled={newTypeBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={submitNewType}
                disabled={newTypeBusy || !newTypeLabel.trim()}
              >
                {newTypeBusy ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}

// ── Upload progress ──────────────────────────────────────────

function UploadProgress({ drafts }: { drafts: ItemDraft[] }) {
  return (
    <ul className="space-y-2.5">
      {drafts.map((d) => (
        <li
          key={d.fileKey}
          className="flex items-center gap-3 p-3 rounded-lg border border-border"
        >
          <span className="w-8 h-8 rounded bg-gray-100 dark:bg-gray-800 flex-shrink-0 overflow-hidden flex items-center justify-center">
            {d.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.preview} alt="" className="w-full h-full object-cover" />
            ) : (
              <UploadIcon size={14} className="text-text-muted" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground truncate">{d.title}</div>
            <div className="text-xs text-text-muted truncate">
              {d.file.name}
            </div>
            {d.uploadState === "uploading" ? (
              <div className="mt-1 h-1 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${d.progress}%` }}
                />
              </div>
            ) : null}
            {d.uploadState === "failed" ? (
              <div className="mt-1 text-xs text-red-600">{d.error}</div>
            ) : null}
          </div>
          <div className="flex-shrink-0">
            {d.uploadState === "uploading" ? (
              <Loader2 size={16} className="animate-spin text-primary-500" />
            ) : d.uploadState === "uploaded" ? (
              <CheckCircle2 size={16} className="text-status-green" />
            ) : d.uploadState === "failed" ? (
              <AlertCircle size={16} className="text-red-600" />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
