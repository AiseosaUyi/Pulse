"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Link2, Check, Loader2, Download, AlertTriangle } from "lucide-react";
import { saveContentFromUrl } from "@/lib/actions/saved-content";

type FeedbackKind = "idle" | "extracting" | "success" | "partial" | "error";

interface Feedback {
  kind: FeedbackKind;
  message?: string;
  savedId?: string;
  thumbnailUrl?: string | null;
  extractionStatus?: string;
}

export function ContentExtractor({ tenantSlug }: { tenantSlug: string }) {
  const [url, setUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const [fb, setFb] = useState<Feedback>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  // Tick the elapsed counter while extracting — surfaces the "still
  // working" state so the user doesn't bail during a cold-start wait.
  useEffect(() => {
    if (!isPending) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    if (startedAt.current == null) startedAt.current = Date.now();
    const tick = setInterval(() => {
      if (startedAt.current != null) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 500);
    return () => clearInterval(tick);
  }, [isPending]);

  const handleSave = () => {
    if (!url.trim()) return;
    setFb({ kind: "extracting" });
    startTransition(async () => {
      const res = await saveContentFromUrl(tenantSlug, url);
      if (!res.success) {
        setFb({ kind: "error", message: res.error });
        return;
      }
      if (res.extractionStatus === "extracted") {
        setFb({
          kind: "success",
          message: res.message,
          savedId: res.id,
          thumbnailUrl: res.thumbnailUrl,
          extractionStatus: res.extractionStatus,
        });
      } else {
        setFb({
          kind: "partial",
          message: res.message,
          extractionStatus: res.extractionStatus,
        });
      }
      setUrl("");
    });
  };

  return (
    <div className="bg-card rounded-xl p-5 border border-border/50 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Link2 size={16} className="text-primary-500" />
        <h2 className="text-sm font-semibold text-foreground">Extract a video</h2>
        <span className="text-text-muted text-xs ml-2">
          TikTok, Instagram, YouTube, Twitter/X, Facebook — we pull the HD
          no-watermark media and save it to your vault.
        </span>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (fb.kind !== "idle" && fb.kind !== "extracting") {
                setFb({ kind: "idle" });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="https://www.tiktok.com/@creator/video/..."
            disabled={isPending}
            className="w-full bg-background border border-border/50 rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-text-muted
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={!url.trim() || isPending}
          className="px-5 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-lg
            hover:bg-primary-600 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center gap-2"
        >
          {isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {elapsed > 0 ? `Extracting... ${elapsed}s` : "Extracting..."}
            </>
          ) : fb.kind === "success" ? (
            <>
              <Check size={14} />
              Saved
            </>
          ) : (
            <>
              <Download size={14} />
              Extract & save
            </>
          )}
        </button>
      </div>

      {fb.kind === "extracting" && elapsed >= 10 && (
        <p className="mt-3 text-text-muted text-xs">
          First extraction of the day is slow — the downloader instance wakes
          up on demand (cold start ~15-30s). Later extractions are fast.
        </p>
      )}

      {fb.kind === "success" && (
        <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-status-green/10 border border-status-green/30">
          <Check size={16} className="text-status-green shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-foreground text-sm font-medium">
              {fb.message ?? "Saved to vault."}
            </p>
            {fb.savedId && (
              <a
                href={`/api/vault/download/${fb.savedId}`}
                className="text-primary-500 text-xs hover:underline inline-flex items-center gap-1 mt-1"
              >
                <Download size={10} />
                Download MP4 to device
              </a>
            )}
          </div>
        </div>
      )}

      {fb.kind === "partial" && (
        <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-status-yellow/10 border border-status-yellow/30">
          <AlertTriangle size={16} className="text-status-yellow shrink-0 mt-0.5" />
          <p className="text-foreground text-sm">{fb.message}</p>
        </div>
      )}

      {fb.kind === "error" && (
        <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-status-red/10 border border-status-red/30">
          <AlertTriangle size={16} className="text-status-red shrink-0 mt-0.5" />
          <p className="text-foreground text-sm">{fb.message ?? "Save failed."}</p>
        </div>
      )}

      <p className="text-text-muted text-[11px] mt-3">
        Powered by a self-hosted cobalt instance (for IG/YT/X/FB) + tikwm (for TikTok). LinkedIn saves as a link only.
      </p>
    </div>
  );
}
