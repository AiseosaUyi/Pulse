"use client";

import { useState, useTransition } from "react";
import { Link2, Check, Loader2 } from "lucide-react";
import { saveContentFromUrl } from "@/lib/actions/saved-content";

export function ContentExtractor({ tenantSlug }: { tenantSlug: string }) {
  const [url, setUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (!url.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveContentFromUrl(tenantSlug, url);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setUrl("");
      setTimeout(() => setSaved(false), 2500);
    });
  };

  return (
    <div className="bg-card rounded-xl p-5 border border-border/50 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Link2 size={16} className="text-primary-500" />
        <h2 className="text-sm font-semibold text-foreground">Save a link</h2>
        <span className="text-text-muted text-xs ml-2">
          Paste a TikTok, Instagram, Twitter, or YouTube URL
        </span>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="https://tiktok.com/@user/video/123456..."
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
              Saving...
            </>
          ) : saved ? (
            <>
              <Check size={14} />
              Saved
            </>
          ) : (
            "Save to vault"
          )}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <p className="text-text-muted text-[11px] mt-3">
        We store the link + platform for later reference. Editing / watermark
        removal stays manual for now.
      </p>
    </div>
  );
}
