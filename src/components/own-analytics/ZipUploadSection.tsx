"use client";

import { useRef, useState, useTransition } from "react";
import { Archive, Loader2, Check, AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractZip, detectZipPlatform } from "@/lib/analytics/zip-extractor";
import { parseInstagramZip } from "@/lib/analytics/parsers/instagram";
import { parseTwitterZip } from "@/lib/analytics/parsers/twitter";
import { parseTikTokZip } from "@/lib/analytics/parsers/tiktok";
import { importAnalyticsPosts, generateAnalyticsReport } from "@/lib/actions/analytics-import";
import type { ImportablePost } from "@/lib/actions/analytics-import";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

type Phase = "idle" | "extracting" | "parsing" | "importing" | "analysing" | "done" | "error";

interface Props {
  tenantSlug: string;
  onDone?: () => void;
}

export function ZipUploadSection({ tenantSlug, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startT] = useTransition();

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  const handleFile = async (file: File) => {
    setError(null);
    setLog([]);
    setPhase("extracting");

    let files;
    try {
      addLog(`Opening ${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)…`);
      files = await extractZip(file);
      addLog(`Found ${files.length} analytics files — skipped all media.`);
    } catch (e) {
      setPhase("error");
      setError(`Could not open ZIP: ${String(e)}`);
      return;
    }

    setPhase("parsing");
    const platform = detectZipPlatform(files);
    addLog(`Detected platform: ${platform ?? "unknown"}`);

    let posts: ImportablePost[] = [];

    if (platform === "instagram") {
      const igPosts = parseInstagramZip(files);
      addLog(`Parsed ${igPosts.length} Instagram posts/stories/reels.`);
      posts = igPosts.map((p) => ({
        capturedAt: p.timestamp.toISOString(),
        platform: "instagram" as OwnMetricsPlatform,
        caption: p.caption,
        externalUrl: p.permalink,
        mediaType: p.mediaType,
        metrics: { likes: p.likes },
      }));
    } else if (platform === "twitter") {
      const tweets = parseTwitterZip(files);
      addLog(`Parsed ${tweets.length} tweets.`);
      posts = tweets.map((t) => ({
        capturedAt: t.timestamp.toISOString(),
        platform: "twitter" as OwnMetricsPlatform,
        caption: t.text,
        externalUrl: t.permalink,
        metrics: {
          impressions: t.impressions,
          engagements: t.engagements,
          likes: t.likes,
          shares: t.retweets,
          replies: t.replies,
          bookmarks: t.bookmarks,
          profileClicks: t.profileClicks,
          videoViews: t.videoViews,
        },
      }));
    } else if (platform === "tiktok") {
      const videos = parseTikTokZip(files);
      addLog(`Parsed ${videos.length} TikTok videos.`);
      posts = videos.map((v) => ({
        capturedAt: v.timestamp.toISOString(),
        platform: "tiktok" as OwnMetricsPlatform,
        externalUrl: v.link,
        metrics: {
          likes: v.likes,
          comments: v.comments,
          shares: v.shares,
          views: v.views,
        },
      }));
    } else {
      setPhase("error");
      setError("Could not detect platform from this ZIP. Expected Instagram, Twitter/X, or TikTok data export.");
      return;
    }

    if (!posts.length) {
      setPhase("error");
      setError("No posts found in the ZIP. The analytics files may be in an unexpected format.");
      return;
    }

    setPhase("importing");
    addLog(`Importing ${posts.length} posts…`);

    startT(async () => {
      const importRes = await importAnalyticsPosts(tenantSlug, posts);
      if (!importRes.success) {
        setPhase("error");
        setError(importRes.error);
        return;
      }
      addLog(`Saved ${importRes.inserted} posts.`);

      setPhase("analysing");
      addLog("Running AI analysis…");
      await generateAnalyticsReport(tenantSlug, platform, posts);
      addLog("AI report ready.");
      setPhase("done");
      onDone?.();
    });
  };

  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Archive size={16} className="text-primary-500" />
        <h3 className="text-foreground font-semibold text-sm">Import full data export (ZIP)</h3>
      </div>
      <p className="text-xs text-text-muted mb-4 leading-relaxed">
        Upload the ZIP from Instagram, Twitter/X, or TikTok "Download your data". We extract only the analytics files
        in your browser — the 700 MB+ of media is never read or uploaded.
      </p>

      <div className="text-[11px] text-text-muted mb-3 space-y-0.5">
        <p><span className="font-medium text-foreground">Instagram:</span> Settings → Your activity → Download your information</p>
        <p><span className="font-medium text-foreground">Twitter/X:</span> Settings → Your account → Download an archive</p>
        <p><span className="font-medium text-foreground">TikTok:</span> Settings → Privacy → Personalisation and data → Download data</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
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
        className="gap-1.5"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
        {busy ? "Processing…" : "Choose ZIP file"}
      </Button>

      {log.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {log.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-text-muted">
              {i === log.length - 1 && phase !== "done" && phase !== "error"
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
          Import complete — refresh to see your updated analytics.
        </div>
      )}

      {phase === "error" && error && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-red-500">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
    </div>
  );
}
