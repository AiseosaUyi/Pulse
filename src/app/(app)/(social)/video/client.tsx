"use client";

/* eslint-disable @next/next/no-img-element, jsx-a11y/media-has-caption */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Image as ImageIcon,
  Clapperboard,
  Upload,
  Users,
  Loader2,
  Volume2,
  VolumeX,
  X,
  ChevronRight,
  Plus,
} from "lucide-react";
import { createGeneration, createSignedVideoUpload, registerVideoAsset } from "@/lib/actions/video-generate";
import { estimateSeedanceCredits } from "@/lib/video/providers/seedance-constraints";
import { toast } from "@/components/ui/Toaster";
import type { ClipMode, VideoCharacter } from "@/lib/types/video";
import type {
  GenerationSummary,
  ApprovedContentOption,
} from "@/lib/services/video-projects";

type Mode = ClipMode; // identity | continuity | replicate
// `soon` marks a mode the provider can't serve yet (disabled in the picker, not
// removed — so the capability is visible and flips on the day it lands).
const MODES: { id: Mode; label: string; icon: typeof Sparkles; hint: string; soon?: boolean }[] = [
  { id: "identity", label: "Prompt", icon: Sparkles, hint: "Describe it. Add a character for a consistent face." },
  { id: "continuity", label: "Image → Video", icon: ImageIcon, hint: "Upload a start (and optional end) frame + a prompt." },
  { id: "replicate", label: "Recreate", icon: Clapperboard, hint: "Video-to-video isn't available on the PicsArt GenAI API yet — coming soon. For now, grab a frame from your reference and use Image → Video.", soon: true },
];

const ASPECTS = ["9:16", "16:9", "1:1"] as const;
const RESOLUTIONS = ["480p", "720p", "1080p"] as const;

export function VideoStudioClient({
  characters,
  characterAvatars,
  generations,
  approvedContent,
  providerConfigured,
  creditBalance,
}: {
  characters: VideoCharacter[];
  characterAvatars: Record<string, string>;
  generations: GenerationSummary[];
  approvedContent: ApprovedContentOption[];
  providerConfigured: boolean;
  creditBalance: number | null;
}) {
  const router = useRouter();
  const [pending, startGen] = useTransition();

  const [mode, setMode] = useState<Mode>("identity");
  const [prompt, setPrompt] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [model, setModel] = useState("seedance-2.0");
  const [durationS, setDurationS] = useState(8);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>("720p");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECTS)[number]>("9:16");
  const [generateAudio, setGenerateAudio] = useState(false);

  const [sourceVideo, setSourceVideo] = useState<{ id: string; url: string } | null>(null);
  const [startFrame, setStartFrame] = useState<{ id: string; url: string } | null>(null);
  const [endFrame, setEndFrame] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const isFast = model.includes("fast");
  // Fast tier caps at 720p.
  useEffect(() => {
    if (isFast && resolution === "1080p") setResolution("720p");
  }, [isFast, resolution]);

  const estimate = useMemo(
    () => estimateSeedanceCredits(model, { duration: durationS, resolution }),
    [model, durationS, resolution]
  );
  // Per-model estimate at the current duration/res, so the picker shows the
  // cost trade-off live. These are calibrated estimates — the real charge is
  // whatever PicsArt deducts; creditBalance is the live truth.
  const perModel = useMemo(
    () =>
      ["seedance-2.0", "seedance-1.5", "kling-3.0", "seedance-2.0-fast"].map((id) => ({
        id,
        cr: estimateSeedanceCredits(id, { duration: durationS, resolution }),
      })),
    [durationS, resolution]
  );
  const overBudget = creditBalance != null && estimate > creditBalance;

  async function upload(role: "source_video" | "start_frame" | "end_frame", file: File) {
    setUploading(role);
    const kind = file.type.startsWith("video/") ? "video" : "image";
    // 1. R2 presigned PUT URL from server (tiny request)
    const signed = await createSignedVideoUpload({ contentType: file.type });
    if (!signed.success) {
      setUploading(null);
      return toast.error(signed.error);
    }
    // 2. upload bytes DIRECTLY to R2 — no server-action body limit
    const putRes = await fetch(signed.url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!putRes.ok) {
      setUploading(null);
      return toast.error(`Upload failed: ${putRes.status}`);
    }
    // 3. register the asset
    const reg = await registerVideoAsset({ kind, role, key: signed.key });
    setUploading(null);
    if (!reg.success) return toast.error(reg.error);
    const a = { id: reg.assetId, url: reg.url };
    if (role === "source_video") setSourceVideo(a);
    if (role === "start_frame") setStartFrame(a);
    if (role === "end_frame") setEndFrame(a);
  }

  function generate() {
    if (!providerConfigured) return toast.error("Connect PicsArt first (set PICSART_API_KEY).");
    if (!prompt.trim()) return toast.error("Write a prompt.");
    if (mode === "replicate" && !sourceVideo) return toast.error("Upload a reference video.");
    if (mode === "continuity" && !startFrame) return toast.error("Upload a start frame.");
    startGen(async () => {
      const res = await createGeneration({
        mode,
        prompt,
        characterId,
        model,
        durationS,
        resolution,
        aspectRatio,
        generateAudio,
        sourceVideoAssetId: sourceVideo?.id ?? null,
        startFrameAssetId: startFrame?.id ?? null,
        endFrameAssetId: endFrame?.id ?? null,
      });
      if (res.success) {
        toast.success("Generating…");
        setPrompt("");
        setSourceVideo(null);
        setStartFrame(null);
        setEndFrame(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // Drive generation while anything is still rendering: poll each generating
  // project's status endpoint (advances the runner), then refresh.
  const generatingIds = generations.filter((g) => g.status === "generating").map((g) => g.id);
  const generatingKey = generatingIds.join(",");
  useEffect(() => {
    if (!generatingKey) return;
    const iv = setInterval(async () => {
      await Promise.all(
        generatingKey.split(",").map((id) =>
          fetch(`/api/video/projects/${id}/status`).catch(() => undefined)
        )
      );
      router.refresh();
    }, 6000);
    return () => clearInterval(iv);
  }, [generatingKey, router]);

  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">Video studio</h1>
            <p className="text-sm text-text-muted mt-0.5">
              Generate short-form video with consistent characters. Prompt it, animate a frame, or recreate a reference.
            </p>
          </div>
        </div>
        <Link href="/video/characters" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-sidebar">
          <Users size={15} /> Characters
        </Link>
      </header>

      {!providerConfigured && (
        <div className="mb-5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Video provider isn’t connected yet. Storyboards still build, but generation needs <code>PICSART_API_KEY</code> in Vercel.
        </div>
      )}

      <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* ── Composer ─────────────────────────────────────────── */}
        <section className="lg:sticky lg:top-6 bg-card border border-border rounded-2xl p-4 space-y-4">
          {/* Mode tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-background p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => !m.soon && setMode(m.id)}
                disabled={m.soon}
                title={m.soon ? "Coming soon" : undefined}
                className={`relative flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium transition-colors ${
                  m.soon
                    ? "text-text-muted/50 cursor-not-allowed"
                    : mode === m.id
                      ? "bg-card text-primary-500 shadow-sm"
                      : "text-text-muted hover:text-foreground"
                }`}
              >
                <m.icon size={16} />
                {m.label}
                {m.soon && <span className="absolute top-1 right-1 text-[8px] font-semibold uppercase tracking-wide text-text-muted/60">Soon</span>}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted -mt-1">{MODES.find((m) => m.id === mode)!.hint}</p>

          {/* Character picker */}
          <div>
            <Label>Character {mode !== "continuity" ? "" : "(ignored in frame mode)"}</Label>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {characters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCharacterId((id) => (id === c.id ? null : c.id))}
                  title={c.name}
                  disabled={mode === "continuity"}
                  className={`relative shrink-0 h-14 w-14 rounded-xl overflow-hidden border-2 transition-colors disabled:opacity-40 ${
                    characterId === c.id ? "border-primary-500" : "border-border"
                  }`}
                >
                  {characterAvatars[c.id] ? (
                    <img src={characterAvatars[c.id]} alt={c.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-text-muted">{c.name.slice(0, 8)}</span>
                  )}
                </button>
              ))}
              <Link href="/video/characters" className="shrink-0 h-14 w-14 rounded-xl border border-dashed border-border flex items-center justify-center text-text-muted hover:bg-sidebar">
                <Plus size={16} />
              </Link>
            </div>
          </div>

          {/* Mode-specific uploads */}
          {mode === "continuity" && (
            <div className="grid grid-cols-2 gap-2">
              <Dropzone label="Start frame" accept="image/*" asset={startFrame} busy={uploading === "start_frame"} onFile={(f) => upload("start_frame", f)} onClear={() => setStartFrame(null)} kind="image" />
              <Dropzone label="End frame (optional)" accept="image/*" asset={endFrame} busy={uploading === "end_frame"} onFile={(f) => upload("end_frame", f)} onClear={() => setEndFrame(null)} kind="image" />
            </div>
          )}
          {mode === "replicate" && (
            <Dropzone label="Reference video" accept="video/*" asset={sourceVideo} busy={uploading === "source_video"} onFile={(f) => upload("source_video", f)} onClear={() => setSourceVideo(null)} kind="video" />
          )}

          {/* Prompt + approved content */}
          <div>
            <Label>Prompt</Label>
            {approvedContent.length > 0 && (
              <select
                onChange={(e) => {
                  const opt = approvedContent.find((o) => o.id === e.target.value);
                  if (opt) setPrompt(opt.prompt);
                }}
                defaultValue=""
                className="w-full mb-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-secondary"
              >
                <option value="" disabled>Use approved content…</option>
                {approvedContent.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            )}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="A Lagos host pours a chilled drink at a rooftop party, golden hour, smooth camera push-in…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Settings */}
          <div className="space-y-3">
            <div>
              <Label>Model</Label>
              <Segmented
                options={[
                  { v: "seedance-2.0", l: "Seedance 2.0" },
                  { v: "seedance-1.5", l: "Seedance 1.5" },
                  { v: "kling-3.0", l: "Kling 3.0" },
                  { v: "seedance-2.0-fast", l: "Seedance Fast" },
                ]}
                value={model}
                onChange={setModel}
              />
              <p className="text-[11px] text-text-muted mt-1">
                Seedance 2.0 — best for people. 1.5 / Kling / Fast — cheaper, great for b-roll.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                {perModel.map((m) => (
                  <span key={m.id} className={m.id === model ? "text-primary-500 font-medium" : "text-text-muted"}>
                    {m.id === "seedance-2.0" ? "2.0" : m.id === "seedance-1.5" ? "1.5" : m.id === "kling-3.0" ? "Kling" : "Fast"} ~{m.cr}cr
                  </span>
                ))}
              </div>
            </div>
            <div>
              <Label>Duration · {durationS}s</Label>
              <input type="range" min={4} max={15} value={durationS} onChange={(e) => setDurationS(Number(e.target.value))} className="w-full accent-primary-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Aspect</Label>
                <ChipRow options={ASPECTS} value={aspectRatio} onChange={(v) => setAspectRatio(v as (typeof ASPECTS)[number])} />
              </div>
              <div>
                <Label>Resolution</Label>
                <ChipRow
                  options={RESOLUTIONS}
                  value={resolution}
                  disabledValues={isFast ? ["1080p"] : []}
                  onChange={(v) => setResolution(v as (typeof RESOLUTIONS)[number])}
                />
              </div>
            </div>
            <button
              onClick={() => setGenerateAudio((a) => !a)}
              className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-foreground"
            >
              {generateAudio ? <Volume2 size={14} className="text-primary-500" /> : <VolumeX size={14} />}
              Audio {generateAudio ? "on" : "off"}
            </button>
          </div>

          <button
            onClick={generate}
            disabled={pending || !providerConfigured || overBudget}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 text-white px-4 py-3 text-sm font-medium hover:bg-primary-600 disabled:opacity-60"
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {!providerConfigured
              ? "Connect PicsArt to generate"
              : overBudget
                ? `Need ~${estimate} cr · only ${creditBalance} left`
                : `Generate · ~${estimate} cr`}
          </button>
          {providerConfigured && (
            <p className="text-[11px] text-center -mt-1">
              {creditBalance != null ? (
                <span className={overBudget ? "text-primary-500 font-medium" : "text-text-muted"}>
                  {creditBalance} credits left at PicsArt · est. only — real charge may differ
                </span>
              ) : (
                <span className="text-text-muted">~{estimate} cr is an estimate — PicsArt deducts the real amount</span>
              )}
            </p>
          )}
        </section>

        {/* ── History ──────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-foreground">History</h2>
            <span className="text-xs text-text-muted">{generations.length} generation{generations.length === 1 ? "" : "s"}</span>
          </div>
          {generations.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-10 text-center text-sm text-text-muted">
              Nothing generated yet. Compose on the left and hit Generate.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {generations.map((g) => (
                <Link key={g.id} href={`/video/${g.id}`} className="group bg-card border border-border rounded-2xl overflow-hidden hover:border-primary-500/40 transition-colors">
                  <div className="relative bg-background" style={{ aspectRatio: g.aspectRatio.replace(":", " / ") }}>
                    {g.outputUrl ? (
                      <video src={g.outputUrl} muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        {g.status === "generating" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-primary-500"><Loader2 size={14} className="animate-spin" /> Generating…</span>
                        ) : g.status === "generation_failed" ? (
                          <span className="text-xs text-primary-500">Failed</span>
                        ) : (
                          <span className="text-xs text-text-muted capitalize">{g.status.replace(/_/g, " ")}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm text-foreground line-clamp-2">{g.prompt ?? g.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2 text-[11px] text-text-muted">
                      {g.mode && <Badge>{g.mode}</Badge>}
                      {g.durationS != null && <Badge>{g.durationS}s</Badge>}
                      <Badge>{g.resolution}</Badge>
                      <Badge>{g.aspectRatio}</Badge>
                      {g.creditEstimate != null && <Badge>~{g.creditEstimate} cr</Badge>}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] text-text-muted">
                        {new Date(g.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <ChevronRight size={14} className="text-text-muted group-hover:text-primary-500" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-text-muted mb-1.5 block">{children}</span>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-background px-1.5 py-0.5 capitalize">{children}</span>;
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
            value === o.v ? "bg-card text-primary-500 shadow-sm" : "text-text-muted hover:text-foreground"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function ChipRow({
  options,
  value,
  onChange,
  disabledValues = [],
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  disabledValues?: string[];
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => {
        const disabled = disabledValues.includes(o);
        return (
          <button
            key={o}
            disabled={disabled}
            onClick={() => onChange(o)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
              value === o ? "border-primary-500 text-primary-500 bg-primary-500/5" : "border-border text-text-secondary hover:bg-sidebar"
            } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Dropzone({
  label,
  accept,
  asset,
  busy,
  onFile,
  onClear,
  kind,
}: {
  label: string;
  accept: string;
  asset: { id: string; url: string } | null;
  busy: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
  kind: "image" | "video";
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Label>{label}</Label>
      {asset ? (
        <div className="relative rounded-lg overflow-hidden border border-border">
          {kind === "image" ? (
            <img src={asset.url} alt={label} className="h-24 w-full object-cover" />
          ) : (
            <video src={asset.url} muted className="h-24 w-full object-cover" />
          )}
          <button onClick={onClear} className="absolute top-1 right-1 rounded-full bg-card border border-border p-0.5 text-text-muted hover:text-primary-500">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="h-24 w-full rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-text-muted hover:bg-sidebar disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          <span className="text-[10px] mt-1">{busy ? "Uploading…" : "Upload"}</span>
        </button>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); if (ref.current) ref.current.value = ""; }} />
    </div>
  );
}
