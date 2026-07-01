"use client";

import { useRef, useState, useTransition } from "react";
import {
  Upload, Loader2, Check, AlertCircle, FileArchive,
  FileText, FileJson, Image as ImageIcon, X, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/Dialog";
import { extractZip, detectZipPlatform } from "@/lib/analytics/zip-extractor";
import { parseInstagramZip } from "@/lib/analytics/parsers/instagram";
import { parseTwitterZip } from "@/lib/analytics/parsers/twitter";
import { parseTikTokZip } from "@/lib/analytics/parsers/tiktok";
import { importAnalyticsPosts, generateAnalyticsReport } from "@/lib/actions/analytics-import";
import { uploadCsv, uploadDataExport, uploadScreenshot } from "@/lib/actions/own-metrics";
import type { ImportablePost } from "@/lib/actions/analytics-import";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

const PLATFORMS: { value: OwnMetricsPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter / X" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
];

const ACCEPT = ".zip,.csv,.json,.html,.htm,image/png,image/jpeg,image/webp";

type Phase = "idle" | "processing" | "done" | "error";

interface Step {
  label: string;
  status: "pending" | "active" | "done" | "warn";
}

interface Summary {
  posts: number;
  platform: string;
  aiDone: boolean;
  aiError?: string;
}

function detectFileKind(file: File): "zip" | "csv" | "export" | "image" | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "zip" || file.type.includes("zip")) return "zip";
  if (ext === "csv" || file.type === "text/csv") return "csv";
  if (["json", "html", "htm"].includes(ext)) return "export";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

function KindBadge({ kind }: { kind: ReturnType<typeof detectFileKind> }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    zip: { icon: <FileArchive size={11} />, label: "ZIP archive", cls: "bg-blue-500/10 text-blue-600" },
    csv: { icon: <FileText size={11} />, label: "CSV", cls: "bg-green-500/10 text-green-600" },
    export: { icon: <FileJson size={11} />, label: "JSON / HTML", cls: "bg-amber-500/10 text-amber-600" },
    image: { icon: <ImageIcon size={11} />, label: "Screenshot", cls: "bg-purple-500/10 text-purple-600" },
  };
  if (!kind || !map[kind]) return null;
  const m = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {s.status === "active" && <Loader2 size={12} className="animate-spin text-primary-500 shrink-0" />}
          {s.status === "done" && <Check size={12} className="text-status-green shrink-0" />}
          {s.status === "warn" && <AlertCircle size={12} className="text-amber-500 shrink-0" />}
          {s.status === "pending" && <span className="w-3 h-3 shrink-0 rounded-full border border-border/60" />}
          <span className={s.status === "pending" ? "text-text-muted" : s.status === "warn" ? "text-amber-600" : "text-foreground"}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function readAsText(f: File) {
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result ?? "")); r.onerror = () => rej(r.error); r.readAsText(f); });
}
function readAsDataUrl(f: File) {
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result ?? "")); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

export function ImportDataModal({ open, onClose, tenantSlug }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ReturnType<typeof detectFileKind>>(null);
  const [platform, setPlatform] = useState<string>("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, startT] = useTransition();

  const busy = phase === "processing";

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setKind(null);
    setSteps([]);
    setSummary(null);
    setError(null);
  };

  const handleClose = () => {
    if (busy) return; // locked while processing
    if (phase === "done") window.location.reload();
    onClose();
    setTimeout(reset, 300);
  };

  const setStep = (steps: Step[]) => setSteps([...steps]);

  const run = async (f: File, overridePlatform?: string) => {
    const k = detectFileKind(f);
    if (!k) {
      setError("Unsupported file type. Try a ZIP archive, CSV, JSON/HTML export, or a screenshot.");
      setPhase("error");
      return;
    }

    setFile(f);
    setKind(k);
    setPhase("processing");
    setError(null);
    setSummary(null);

    const usePlatform = (overridePlatform ?? platform) || null;

    // ── ZIP ─────────────────────────────────────────────────────────
    if (k === "zip") {
      const s: Step[] = [
        { label: `Opening ${f.name} (${(f.size / 1024 / 1024).toFixed(0)} MB)`, status: "active" },
        { label: "Finding analytics files", status: "pending" },
        { label: "Parsing posts", status: "pending" },
        { label: "Saving to your account", status: "pending" },
        { label: "AI analysis", status: "pending" },
      ];
      setStep(s);

      let files;
      try {
        files = await extractZip(f);
        s[0].status = "done";
        s[1].status = "active";
        setStep(s);
      } catch (e) {
        setPhase("error");
        setError(`Could not open ZIP: ${String(e)}`);
        return;
      }

      s[1].label = `Found ${files.length} analytics file${files.length !== 1 ? "s" : ""} — media skipped`;
      s[1].status = "done";
      s[2].status = "active";
      setStep(s);

      const detected = detectZipPlatform(files) ?? (usePlatform as OwnMetricsPlatform | null);
      if (!detected) {
        setPhase("error");
        setError("Could not detect the platform from this ZIP. Select a platform manually and try again.");
        return;
      }

      let posts: ImportablePost[] = [];
      try {
        if (detected === "instagram") {
          const p = parseInstagramZip(files);
          posts = p.map((x) => ({ capturedAt: x.timestamp.toISOString(), platform: "instagram", caption: x.caption, externalUrl: x.permalink, metrics: { likes: x.likes, impressions: x.impressions, reach: x.reach, comments: x.comments, shares: x.shares, saves: x.saves } }));
        } else if (detected === "twitter") {
          const p = parseTwitterZip(files);
          posts = p.map((x) => ({ capturedAt: x.timestamp.toISOString(), platform: "twitter", caption: x.text, externalUrl: x.permalink, metrics: { impressions: x.impressions, engagements: x.engagements, likes: x.likes, shares: x.retweets, replies: x.replies, bookmarks: x.bookmarks } }));
        } else if (detected === "tiktok") {
          const p = parseTikTokZip(files);
          posts = p.map((x) => ({ capturedAt: x.timestamp.toISOString(), platform: "tiktok", externalUrl: x.link, metrics: { likes: x.likes, comments: x.comments, shares: x.shares, views: x.views } }));
        } else {
          throw new Error(`Platform "${detected}" is not supported yet.`);
        }
      } catch (e) {
        setPhase("error");
        setError(String(e));
        return;
      }

      if (!posts.length) {
        setPhase("error");
        setError("No posts found in this archive. The analytics files may be in an unexpected format.");
        return;
      }

      s[2].label = `Parsed ${posts.length} posts`;
      s[2].status = "done";
      s[3].status = "active";
      setStep(s);

      startT(async () => {
        const importRes = await importAnalyticsPosts(tenantSlug, posts);
        if (!importRes.success) {
          setPhase("error");
          setError(importRes.error ?? "Import failed. Please try again.");
          return;
        }
        s[3].label = `Saved ${importRes.inserted} posts`;
        s[3].status = "done";
        s[4].status = "active";
        setStep(s);

        let aiError: string | undefined;
        try {
          await generateAnalyticsReport(tenantSlug, detected, posts);
          s[4].label = "AI analysis complete";
          s[4].status = "done";
        } catch {
          s[4].label = "AI analysis skipped — you can retry from the dashboard";
          s[4].status = "warn";
          aiError = "AI analysis did not complete. You can retry it from the Analytics page.";
        }
        setStep(s);

        setSummary({ posts: importRes.inserted, platform: detected, aiDone: !aiError, aiError });
        setPhase("done");
      });
      return;
    }

    // ── CSV ─────────────────────────────────────────────────────────
    if (k === "csv") {
      const s: Step[] = [
        { label: "Reading CSV", status: "active" },
        { label: "Saving rows", status: "pending" },
      ];
      setStep(s);
      const text = await readAsText(f).catch(() => null);
      if (!text) { setPhase("error"); setError("Could not read the file."); return; }
      s[0].status = "done"; s[1].status = "active"; setStep(s);
      startT(async () => {
        const res = await uploadCsv(tenantSlug, (usePlatform || "instagram") as OwnMetricsPlatform, text);
        if (!res.success) { setPhase("error"); setError(res.error); return; }
        s[1].label = `Saved ${res.inserted} rows`; s[1].status = "done"; setStep(s);
        setSummary({ posts: res.inserted, platform: usePlatform || "instagram", aiDone: false });
        setPhase("done");
      });
      return;
    }

    // ── JSON / HTML ──────────────────────────────────────────────────
    if (k === "export") {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const fileType = ["html", "htm"].includes(ext) ? "html" : "json";
      const s: Step[] = [
        { label: "Reading file", status: "active" },
        { label: "Extracting posts", status: "pending" },
        { label: "Saving", status: "pending" },
      ];
      setStep(s);
      const content = await readAsText(f).catch(() => null);
      if (!content) { setPhase("error"); setError("Could not read the file."); return; }
      s[0].status = "done"; s[1].status = "active"; setStep(s);
      startT(async () => {
        const res = await uploadDataExport(tenantSlug, usePlatform as OwnMetricsPlatform | null, fileType, content);
        if (!res.success) { setPhase("error"); setError(res.error); return; }
        s[1].label = `${res.method === "rule-based" ? "Parsed" : "AI extracted"} ${res.inserted} posts`;
        s[1].status = "done"; s[2].label = "Saved"; s[2].status = "done"; setStep(s);
        setSummary({ posts: res.inserted, platform: res.detectedPlatform ?? usePlatform ?? "unknown", aiDone: false });
        setPhase("done");
      });
      return;
    }

    // ── Screenshot ───────────────────────────────────────────────────
    if (k === "image") {
      const s: Step[] = [
        { label: "Reading screenshot", status: "active" },
        { label: "AI reading metrics", status: "pending" },
        { label: "Saving", status: "pending" },
      ];
      setStep(s);
      const dataUrl = await readAsDataUrl(f).catch(() => null);
      if (!dataUrl) { setPhase("error"); setError("Could not read the image."); return; }
      s[0].status = "done"; s[1].status = "active"; setStep(s);
      startT(async () => {
        const res = await uploadScreenshot(tenantSlug, usePlatform as OwnMetricsPlatform | null, dataUrl);
        if (!res.success) { setPhase("error"); setError(res.error); return; }
        s[1].label = `Read metrics from ${res.platform ?? "post"}`; s[1].status = "done";
        s[2].label = "Saved"; s[2].status = "done"; setStep(s);
        setSummary({ posts: 1, platform: res.platform ?? usePlatform ?? "unknown", aiDone: false });
        setPhase("done");
      });
      return;
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) run(f);
  };

  return (
    <Dialog open={open} onClose={handleClose} locked={busy} size="md">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <div>
          <h2 className="text-foreground font-semibold text-[17px]">Import data</h2>
          {phase === "idle" && (
            <p className="text-text-muted text-sm mt-0.5">Select the platform first, then upload your export.</p>
          )}
        </div>
        {!busy && (
          <button type="button" onClick={handleClose} className="text-text-muted hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-6 pb-6 space-y-4">

        {/* ── IDLE ── */}
        {phase === "idle" && (
          <>
            {/* Platform selector — required before anything else */}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1.5">
                Platform <span className="text-red-500">*</span>
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className={`w-full h-9 px-3 rounded-lg border bg-card text-sm transition-colors ${
                  platform ? "border-border text-foreground" : "border-primary-500/50 text-text-muted"
                }`}
              >
                <option value="">Select platform…</option>
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {!platform && (
                <p className="text-[11px] text-text-muted mt-1">Select which platform this data belongs to first.</p>
              )}
            </div>

            {/* Drop zone — locked until platform is chosen */}
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                !platform
                  ? "border-border/30 opacity-40 cursor-not-allowed"
                  : dragging
                  ? "border-primary-500 bg-primary-500/5 cursor-pointer"
                  : "border-border/50 hover:border-primary-500/40 hover:bg-sidebar/40 cursor-pointer"
              }`}
              onClick={() => platform && inputRef.current?.click()}
              onDragOver={(e) => { if (!platform) return; e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { if (!platform) return; onDrop(e); }}
            >
              <Upload size={22} className="mx-auto mb-2 text-text-muted" />
              <p className="text-sm text-foreground font-medium">Drop your file here</p>
              <p className="text-xs text-text-muted mt-1">or <span className="text-primary-500 font-medium">browse</span></p>
              <p className="text-[10px] text-text-muted/60 mt-3 tracking-wide">ZIP · CSV · JSON · HTML · PNG · JPG</p>
            </div>

            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ""; }}
            />

            <Button onClick={() => inputRef.current?.click()} disabled={!platform} className="w-full gap-2">
              <Upload size={14} /> Analyze file
            </Button>
          </>
        )}

        {/* ── PROCESSING ── */}
        {phase === "processing" && (
          <div className="space-y-4">
            {/* File pill */}
            {file && (
              <div className="flex items-center gap-3 p-3 bg-sidebar rounded-xl border border-border/40">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center">
                  <Upload size={14} className="text-primary-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <KindBadge kind={kind} />
                  </div>
                </div>
                <Loader2 size={16} className="animate-spin text-primary-500 shrink-0" />
              </div>
            )}
            <StepList steps={steps} />
            <p className="text-[11px] text-text-muted">Please keep this window open until the import finishes.</p>
          </div>
        )}

        {/* ── DONE ── */}
        {phase === "done" && summary && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-status-green/5 border border-status-green/20">
              <div className="shrink-0 w-9 h-9 rounded-full bg-status-green/10 flex items-center justify-center">
                <Check size={18} className="text-status-green" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Import complete</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {summary.posts} post{summary.posts !== 1 ? "s" : ""} saved
                  {summary.platform ? ` · ${summary.platform}` : ""}
                </p>
              </div>
            </div>

            <StepList steps={steps} />

            {summary.aiError && (
              <div className="flex items-start gap-2 text-[11px] text-amber-600 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {summary.aiError}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleClose} className="flex-1">View analytics</Button>
              <Button variant="outline" onClick={reset} className="gap-1.5">
                <RefreshCw size={13} /> Import more
              </Button>
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Something went wrong</p>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{error}</p>
              </div>
            </div>

            {/* If platform detection failed, let them pick manually */}
            {error?.includes("platform") && (
              <div>
                <label className="text-xs text-text-muted block mb-1.5">Select platform and try again</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
                >
                  <option value="">Pick a platform…</option>
                  {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={() => { reset(); }} variant="outline" className="flex-1">Start over</Button>
              {file && (
                <Button onClick={() => run(file)} className="flex-1 gap-1.5">
                  <RefreshCw size={13} /> Retry
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
