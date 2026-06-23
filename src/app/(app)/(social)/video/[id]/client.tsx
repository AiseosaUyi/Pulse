"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import {
  submitForReview,
  approveProject,
  requestChanges,
  startGeneration,
  retryGeneration,
  exportProject,
  regenerateStoryboard,
  updateClip,
  registerClipAsset,
  clearClipAsset,
  addClip,
  deleteClip,
} from "@/lib/actions/video-projects";
import { createSignedVideoUpload } from "@/lib/actions/video-generate";
import { createClient } from "@/lib/supabase/client";
import { SEEDANCE_MODELS } from "@/lib/video/providers/seedance-constraints";
import { toast } from "@/components/ui/Toaster";
import type { VideoProject, VideoClip, VideoCharacter, ClipMode } from "@/lib/types/video";

const CLIP_STATUS: Record<string, string> = {
  planned: "Planned",
  quoted: "Quoted",
  generating: "Generating…",
  ready: "Ready",
  failed: "Failed",
};

// Mirrors CLIP_EDITABLE in the server action — clips are editable before/around
// generation, never while bytes are in flight or after assembly.
const EDITABLE_STATES = ["draft", "in_review", "approved", "generation_failed"];

// Only text-to-video models are offered (video-to-video isn't available on the
// PicsArt GenAI API yet — see the composer's Recreate "Soon" tab).
const MODEL_OPTIONS = SEEDANCE_MODELS.filter((m) => m.mode === "t2v");

const CLIP_MODES: { id: ClipMode; label: string; soon?: boolean }[] = [
  { id: "identity", label: "Prompt" },
  { id: "continuity", label: "Image → Video" },
  { id: "replicate", label: "Recreate", soon: true },
];

const RESOLUTIONS = ["480p", "720p", "1080p"];

export function VideoProjectDetail({
  project,
  clips,
  assetUrls,
  characters,
  characterAvatars,
}: {
  project: VideoProject;
  clips: VideoClip[];
  assetUrls: Record<string, string>;
  characters: VideoCharacter[];
  characterAvatars: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const [polling, setPolling] = useState(project.status === "generating");
  const editable = EDITABLE_STATES.includes(project.status);

  // Poll the status endpoint while generating; it advances the runner and we
  // refresh when state changes or it completes.
  useEffect(() => {
    if (project.status !== "generating") {
      setPolling(false);
      return;
    }
    setPolling(true);
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/projects/${project.id}/status`);
        const data = await res.json();
        if (data.status !== "generating" || data.done) {
          clearInterval(iv);
          router.refresh();
        } else {
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [project.status, project.id, router]);

  function run(fn: () => Promise<{ success: boolean; error?: string }>, ok: string) {
    startT(async () => {
      const r = await fn();
      if (r.success) {
        toast.success(ok);
        router.refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  const v = project.version;
  const assembledUrl = project.assembledOutputAssetId
    ? assetUrls[project.assembledOutputAssetId]
    : null;
  const readyCount = clips.filter((c) => c.status === "ready").length;

  return (
    <div className="p-4 md:p-8 max-w-[1000px] mx-auto">
      <Link href="/video" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-4">
        <ArrowLeft size={15} /> Video studio
      </Link>

      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">{project.title}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {project.aspectRatio} · {project.targetResolution} · {clips.length} clips
              {project.creditEstimate != null && ` · est. ${project.creditEstimate} cr`}
              {project.creditActual != null && ` · actual ${project.creditActual} cr`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project.status === "draft" && (
            <>
              <button onClick={() => run(() => regenerateStoryboard(project.id), "Storyboard regenerated")} disabled={pending} className="rounded-full border border-border bg-card px-3 py-2 text-sm disabled:opacity-60">Regenerate</button>
              <button onClick={() => run(() => submitForReview(project.id, v), "Submitted for review")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Submit for review</button>
            </>
          )}
          {project.status === "in_review" && (
            <>
              <button onClick={() => run(() => requestChanges(project.id, v), "Sent back to draft")} disabled={pending} className="rounded-full border border-border bg-card px-3 py-2 text-sm disabled:opacity-60">Request changes</button>
              <button onClick={() => run(() => approveProject(project.id, v), "Approved")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Approve</button>
            </>
          )}
          {project.status === "approved" && (
            <button onClick={() => run(() => startGeneration(project.id, v), "Generation started")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Start generation</button>
          )}
          {project.status === "generation_failed" && (
            <button onClick={() => run(() => retryGeneration(project.id, v), "Retrying")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Retry</button>
          )}
          {project.status === "assembled" && (
            <button onClick={() => run(() => exportProject(project.id, v), "Exported")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Export</button>
          )}
        </div>
      </header>

      {project.status === "approved" && (
        <div className="mb-4 rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          Approved. Generation will quote every clip and check your budget before spending any credits.
        </div>
      )}
      {polling && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-primary-500/5 border border-primary-500/20 px-4 py-3 text-sm text-primary-600 dark:text-primary-400">
          <Loader2 size={15} className="animate-spin" /> Generating — {readyCount}/{clips.length} clips ready. This page updates itself.
        </div>
      )}
      {project.lastError && (
        <div className="mb-4 rounded-xl bg-primary-500/5 border border-primary-500/20 px-4 py-3 text-sm text-primary-600">{project.lastError}</div>
      )}

      {assembledUrl && (
        <div className="mb-6 bg-card border border-border rounded-2xl p-3">
          <p className="text-sm font-medium text-foreground mb-2">Assembled video</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={assembledUrl} controls className="w-full rounded-xl max-h-[70vh]" />
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-foreground">Storyboard</span>
          {!editable && (
            <span className="text-xs text-text-muted">Read-only while {project.status.replace("_", " ")}</span>
          )}
        </div>
        <ul>
          {clips.map((c) =>
            editable ? (
              <EditableClip
                key={c.id}
                clip={c}
                characters={characters}
                characterAvatars={characterAvatars}
                assetUrls={assetUrls}
                onChanged={() => router.refresh()}
              />
            ) : (
              <li key={c.id} className="border-b border-border/50 last:border-0 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-text-muted mb-0.5">
                      Clip {c.seq} · {c.mode} · {c.model} · {c.durationS}s
                    </p>
                    <p className="text-sm text-foreground">{c.prompt}</p>
                    {c.lastError && <p className="text-xs text-primary-500 mt-1">{c.lastError}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-text-muted">{CLIP_STATUS[c.status] ?? c.status}</span>
                </div>
                {c.outputAssetId && assetUrls[c.outputAssetId] && (
                  /* eslint-disable-next-line jsx-a11y/media-has-caption */
                  <video src={assetUrls[c.outputAssetId]} controls className="mt-2 w-48 rounded-lg" />
                )}
              </li>
            )
          )}
        </ul>
        {editable && (
          <div className="px-4 py-3 border-t border-border">
            <button
              onClick={() => run(() => addClip(project.id), "Clip added")}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-sidebar disabled:opacity-60"
            >
              <Plus size={15} /> Add clip
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Editable clip card ──────────────────────────────────────────────────────
function EditableClip({
  clip,
  characters,
  characterAvatars,
  assetUrls,
  onChanged,
}: {
  clip: VideoClip;
  characters: VideoCharacter[];
  characterAvatars: Record<string, string>;
  assetUrls: Record<string, string>;
  onChanged: () => void;
}) {
  const [pending, startT] = useTransition();
  const [prompt, setPrompt] = useState(clip.prompt);
  const [mode, setMode] = useState<ClipMode>(clip.mode);
  const [model, setModel] = useState(clip.model);
  const [durationS, setDurationS] = useState(clip.durationS);
  const [resolution, setResolution] = useState(clip.resolution);
  const [characterId, setCharacterId] = useState<string | null>(clip.characterId);

  const dirty =
    prompt !== clip.prompt ||
    mode !== clip.mode ||
    model !== clip.model ||
    durationS !== clip.durationS ||
    resolution !== clip.resolution ||
    characterId !== clip.characterId;

  function save() {
    startT(async () => {
      const r = await updateClip(clip.id, { prompt, mode, model, durationS, resolution, characterId });
      if (r.success) {
        toast.success(`Clip ${clip.seq} saved`);
        onChanged();
      } else toast.error(r.error);
    });
  }

  function remove() {
    startT(async () => {
      const r = await deleteClip(clip.id);
      if (r.success) {
        toast.success("Clip removed");
        onChanged();
      } else toast.error(r.error);
    });
  }

  return (
    <li className="border-b border-border/50 last:border-0 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">Clip {clip.seq}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{CLIP_STATUS[clip.status] ?? clip.status}</span>
          <button onClick={remove} disabled={pending} title="Remove clip" className="text-text-muted hover:text-primary-500 disabled:opacity-50">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder="Describe this clip…"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
      />

      {/* Mode + model + duration + resolution */}
      <div className="flex flex-wrap gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ClipMode)}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
        >
          {CLIP_MODES.map((m) => (
            <option key={m.id} value={m.id} disabled={m.soon}>
              {m.label}{m.soon ? " (soon)" : ""}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-text-muted">
          <input
            type="number"
            min={1}
            max={20}
            value={durationS}
            onChange={(e) => setDurationS(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          />
          sec
        </label>
        <select
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Character picker (ignored in Image→Video mode) */}
      {mode !== "continuity" && characters.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-xs text-text-muted shrink-0">Character:</span>
          {characters.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setCharacterId((id) => (id === ch.id ? null : ch.id))}
              title={ch.name}
              className={`relative shrink-0 h-10 w-10 rounded-lg overflow-hidden border-2 transition-colors ${
                characterId === ch.id ? "border-primary-500" : "border-border"
              }`}
            >
              {characterAvatars[ch.id] ? (
                <img src={characterAvatars[ch.id]} alt={ch.name} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[9px] text-text-muted">{ch.name.slice(0, 6)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Mode-specific asset uploads */}
      {mode === "continuity" && (
        <div className="grid grid-cols-2 gap-2">
          <ClipAssetSlot clipId={clip.id} role="start_frame" kind="image" label="Start frame" assetId={clip.startFrameAssetId} assetUrls={assetUrls} onChanged={onChanged} />
          <ClipAssetSlot clipId={clip.id} role="end_frame" kind="image" label="End frame (optional)" assetId={clip.endFrameAssetId} assetUrls={assetUrls} onChanged={onChanged} />
        </div>
      )}
      {mode === "replicate" && (
        <div className="space-y-2">
          <ClipAssetSlot clipId={clip.id} role="source_video" kind="video" label="Reference video" assetId={clip.sourceVideoAssetId} assetUrls={assetUrls} onChanged={onChanged} />
          <p className="text-xs text-primary-500">Recreate (video-to-video) isn&apos;t available on the PicsArt API yet — this clip won&apos;t generate until it lands.</p>
        </div>
      )}

      {clip.lastError && <p className="text-xs text-primary-500">{clip.lastError}</p>}

      {clip.outputAssetId && assetUrls[clip.outputAssetId] && (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <video src={assetUrls[clip.outputAssetId]} controls className="w-48 rounded-lg" />
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-full bg-primary-500 text-white px-4 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </li>
  );
}

// One upload slot: shows the attached asset or a dropzone. Bytes go browser →
// Supabase via a signed URL (never through the 1 MB server-action body limit).
function ClipAssetSlot({
  clipId,
  role,
  kind,
  label,
  assetId,
  assetUrls,
  onChanged,
}: {
  clipId: string;
  role: "source_video" | "start_frame" | "end_frame";
  kind: "video" | "image";
  label: string;
  assetId: string | null;
  assetUrls: Record<string, string>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const url = assetId ? assetUrls[assetId] : null;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const accept = kind === "video" ? "video/" : "image/";
    if (!file.type.startsWith(accept)) {
      toast.error(`${label} must be ${kind === "video" ? "a video" : "an image"}`);
      return;
    }
    setBusy(true);
    (async () => {
      try {
        const signed = await createSignedVideoUpload({ contentType: file.type });
        if (!signed.success) return toast.error(signed.error);
        const putRes = await fetch(signed.url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) return toast.error(`Upload failed: ${putRes.status}`);
        const r = await registerClipAsset({ clipId, role, kind, key: signed.key });
        if (r.success) {
          toast.success(`${label} uploaded`);
          onChanged();
        } else toast.error(r.error);
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    })();
  }

  function clear() {
    setBusy(true);
    (async () => {
      const r = await clearClipAsset(clipId, role);
      if (r.success) onChanged();
      else toast.error(r.error);
      setBusy(false);
    })();
  }

  if (url) {
    return (
      <div className="relative rounded-lg border border-border overflow-hidden">
        {kind === "video" ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <video src={url} className="h-24 w-full object-cover" />
        ) : (
          <img src={url} alt={label} className="h-24 w-full object-cover" />
        )}
        <button onClick={clear} disabled={busy} className="absolute top-1 right-1 rounded-full bg-card border border-border p-0.5 text-text-muted hover:text-primary-500">
          <X size={12} />
        </button>
        <span className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1.5 py-0.5">{label}</span>
      </div>
    );
  }

  return (
    <button
      onClick={() => fileRef.current?.click()}
      disabled={busy}
      className="h-24 w-full rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-text-muted hover:bg-sidebar disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
      <span className="text-[10px] mt-1">{label}</span>
      <input ref={fileRef} type="file" accept={kind === "video" ? "video/*" : "image/*"} onChange={onFile} className="hidden" />
    </button>
  );
}
