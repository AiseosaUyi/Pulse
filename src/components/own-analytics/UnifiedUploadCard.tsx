"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractZip, detectZipPlatform } from "@/lib/analytics/zip-extractor";
import { parseInstagramZip } from "@/lib/analytics/parsers/instagram";
import { parseTwitterZip } from "@/lib/analytics/parsers/twitter";
import { parseTikTokZip } from "@/lib/analytics/parsers/tiktok";
import {
  importAnalyticsPosts,
  generateAnalyticsReport,
} from "@/lib/actions/analytics-import";
import { uploadCsv, uploadDataExport, uploadScreenshot } from "@/lib/actions/own-metrics";
import type { ImportablePost } from "@/lib/actions/analytics-import";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

const PLATFORMS: { value: OwnMetricsPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter / X" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
];

const ACCEPT = ".zip,.csv,.json,.html,.htm,image/png,image/jpeg,image/webp,application/zip,text/csv,application/json,text/html";

type Phase = "idle" | "processing" | "done" | "error";

function readAsText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result ?? ""));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result ?? ""));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

interface Props {
  tenantSlug: string;
  onDone?: () => void;
}

export function UnifiedUploadCard({ tenantSlug, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [, startT] = useTransition();

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  const reset = () => {
    setPhase("idle");
    setLog([]);
    setError(null);
  };

  const handleFile = async (file: File) => {
    reset();
    setPhase("processing");

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isZip = ext === "zip" || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    const isCsv = ext === "csv" || file.type === "text/csv";
    const isDataExport = ["json", "html", "htm"].includes(ext);
    const isImage = file.type.startsWith("image/");

    try {
      if (isZip) {
        addLog(`Opening ${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)…`);
        const files = await extractZip(file);
        addLog(`Found ${files.length} analytics files — skipped all media.`);

        const detected = detectZipPlatform(files);
        addLog(`Detected: ${detected ?? "unknown"}`);

        let posts: ImportablePost[] = [];

        if (detected === "instagram") {
          const parsed = parseInstagramZip(files);
          addLog(`Parsed ${parsed.length} posts.`);
          posts = parsed.map((p) => ({
            capturedAt: p.timestamp.toISOString(),
            platform: "instagram",
            caption: p.caption,
            externalUrl: p.permalink,
            metrics: { likes: p.likes, impressions: p.impressions, reach: p.reach, comments: p.comments, shares: p.shares, saves: p.saves },
          }));
        } else if (detected === "twitter") {
          const parsed = parseTwitterZip(files);
          addLog(`Parsed ${parsed.length} tweets.`);
          posts = parsed.map((t) => ({
            capturedAt: t.timestamp.toISOString(),
            platform: "twitter",
            caption: t.text,
            externalUrl: t.permalink,
            metrics: {
              impressions: t.impressions,
              engagements: t.engagements,
              likes: t.likes,
              shares: t.retweets,
              replies: t.replies,
              bookmarks: t.bookmarks,
            },
          }));
        } else if (detected === "tiktok") {
          const parsed = parseTikTokZip(files);
          addLog(`Parsed ${parsed.length} videos.`);
          posts = parsed.map((v) => ({
            capturedAt: v.timestamp.toISOString(),
            platform: "tiktok",
            externalUrl: v.link,
            metrics: { likes: v.likes, comments: v.comments, shares: v.shares, views: v.views },
          }));
        } else {
          throw new Error("Could not detect platform from this ZIP. Try Instagram, Twitter/X, or TikTok data exports.");
        }

        if (!posts.length) throw new Error("No posts found in the ZIP.");

        addLog(`Saving ${posts.length} posts…`);
        startT(async () => {
          const res = await importAnalyticsPosts(tenantSlug, posts);
          if (!res.success) { setPhase("error"); setError(res.error); return; }
          addLog(`Saved. Running AI analysis…`);
          await generateAnalyticsReport(tenantSlug, detected!, posts);
          addLog("Analysis complete.");
          setPhase("done");
          onDone?.();
        });

      } else if (isCsv) {
        addLog("Reading CSV…");
        const text = await readAsText(file);
        const csvPlatform = (platform || "instagram") as OwnMetricsPlatform;
        startT(async () => {
          const res = await uploadCsv(tenantSlug, csvPlatform, text);
          if (!res.success) { setPhase("error"); setError(res.error); return; }
          addLog(`Imported ${res.inserted} rows.`);
          setPhase("done");
          onDone?.();
        });

      } else if (isDataExport) {
        addLog("Reading file…");
        const content = await readAsText(file);
        const fileType = ["html", "htm"].includes(ext) ? "html" : "json";
        startT(async () => {
          const res = await uploadDataExport(
            tenantSlug,
            (platform || null) as OwnMetricsPlatform | null,
            fileType,
            content
          );
          if (!res.success) { setPhase("error"); setError(res.error); return; }
          const via = res.method === "rule-based" ? "Parsed" : "AI extracted";
          addLog(`${via} ${res.inserted} posts from ${res.detectedPlatform ?? platform ?? "your export"}.`);
          setPhase("done");
          onDone?.();
        });

      } else if (isImage) {
        addLog("Reading screenshot…");
        const dataUrl = await readAsDataUrl(file);
        startT(async () => {
          const res = await uploadScreenshot(
            tenantSlug,
            (platform || null) as OwnMetricsPlatform | null,
            dataUrl
          );
          if (!res.success) { setPhase("error"); setError(res.error); return; }
          addLog(`Saved ${res.platform} metrics.`);
          setPhase("done");
          onDone?.();
        });

      } else {
        throw new Error("Unrecognised file. Try a ZIP archive, CSV, JSON, HTML, or screenshot.");
      }
    } catch (e) {
      setPhase("error");
      setError(String(e));
    }
  };

  const busy = phase === "processing";

  return (
    <div
      className={`bg-card rounded-2xl border p-5 flex flex-col transition-colors ${dragging ? "border-primary-500 bg-primary-500/5" : "border-border"}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Upload size={15} className="text-primary-500" />
        <h3 className="font-semibold text-sm text-foreground">Import your data</h3>
      </div>
      <p className="text-xs text-text-muted mb-4 grow">
        Drop any file — we'll detect the type. Works with ZIP archives, CSVs, JSON exports, and screenshots.
      </p>

      <div className="space-y-3">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          disabled={busy}
          className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
        >
          <option value="">Auto-detect platform</option>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await handleFile(f);
            e.target.value = "";
          }}
        />

        <Button
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="gap-1.5 w-fit"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {busy ? "Processing…" : "Choose file"}
        </Button>
      </div>

      {log.length > 0 && (
        <div className="mt-4 space-y-0.5">
          {log.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-text-muted">
              {i === log.length - 1 && phase === "processing"
                ? <Loader2 size={10} className="animate-spin text-primary-500 shrink-0" />
                : <Check size={10} className="text-status-green shrink-0" />}
              {l}
            </div>
          ))}
        </div>
      )}

      {phase === "done" && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-status-green">
          <Check size={12} />
          Done — refresh to see your analytics.
        </div>
      )}

      {phase === "error" && error && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-red-500">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>{error} <button type="button" onClick={reset} className="underline ml-1">Try again</button></span>
        </div>
      )}
    </div>
  );
}
