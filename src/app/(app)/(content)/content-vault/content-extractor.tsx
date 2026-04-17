"use client";

import { useState } from "react";
import { Link2, Download, Check, Loader2 } from "lucide-react";

type ExtractStatus = "idle" | "extracting" | "success" | "error";

export function ContentExtractor() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<ExtractStatus>("idle");
  const [extracted, setExtracted] = useState<{
    title: string;
    platform: string;
    type: string;
    duration: string;
  } | null>(null);

  function detectPlatform(link: string): string {
    if (link.includes("tiktok.com")) return "TikTok";
    if (link.includes("instagram.com")) return "Instagram";
    if (link.includes("twitter.com") || link.includes("x.com")) return "Twitter/X";
    if (link.includes("youtube.com") || link.includes("youtu.be")) return "YouTube";
    return "Unknown";
  }

  async function handleExtract() {
    if (!url.trim()) return;
    setStatus("extracting");

    // Simulate extraction (in production, this calls a backend API)
    await new Promise((r) => setTimeout(r, 2000));

    const platform = detectPlatform(url);
    setExtracted({
      title: `${platform} video content`,
      platform,
      type: "Video",
      duration: "0:15-0:45",
    });
    setStatus("success");
  }

  function handleSave() {
    setUrl("");
    setStatus("idle");
    setExtracted(null);
  }

  return (
    <div className="bg-card rounded-xl p-5 border border-border/50 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Link2 size={16} className="text-primary-500" />
        <h2 className="text-sm font-semibold text-foreground">Extract Content</h2>
        <span className="text-text-muted text-xs ml-2">
          Paste a TikTok, Instagram, Twitter, or YouTube link
        </span>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            placeholder="https://tiktok.com/@user/video/123456..."
            className="w-full bg-background border border-border/50 rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-text-muted
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          onClick={handleExtract}
          disabled={!url.trim() || status === "extracting"}
          className="px-5 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-lg
            hover:bg-primary-600 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center gap-2"
        >
          {status === "extracting" ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Extracting...
            </>
          ) : (
            <>
              <Download size={14} />
              Extract
            </>
          )}
        </button>
      </div>

      {/* Extraction result */}
      {status === "success" && extracted && (
        <div className="mt-4 p-4 bg-background rounded-lg border border-status-green/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-status-green/10 flex items-center justify-center">
                <Check size={16} className="text-status-green" />
              </div>
              <div>
                <p className="text-foreground text-sm font-medium">Content extracted successfully</p>
                <p className="text-text-muted text-xs mt-0.5">
                  {extracted.platform} · {extracted.type} · {extracted.duration} · Watermark removed
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-3 py-1.5 bg-status-green/10 text-status-green text-xs font-medium rounded-md hover:bg-status-green/20 transition-colors"
              >
                Save to Vault
              </button>
              <button
                onClick={() => { setStatus("idle"); setExtracted(null); }}
                className="px-3 py-1.5 bg-background text-text-secondary text-xs rounded-md hover:text-foreground transition-colors border border-border/50"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-text-muted text-[11px] mt-3">
        Watermarks are automatically detected and removed. Content is saved to your vault for scheduling across platforms.
      </p>
    </div>
  );
}
