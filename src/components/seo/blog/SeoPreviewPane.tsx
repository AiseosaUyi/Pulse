"use client";

// "Preview on Gruve" pane for the blog-writer sidebar
// (PULSE-SEO-SPEC.md §13, acceptance M2). Calls the server action to
// mint a token and embeds Gruve's live preview in an iframe. The token
// is single-use/short-lived; "Refresh" re-mints.

import { useState, useTransition } from "react";
import { ExternalLink, Eye, RefreshCw } from "lucide-react";
import { getSeoPreviewUrl } from "@/lib/actions/seo-preview";
import { syncBlogDraftToContentful } from "@/lib/actions/seo-contentful-sync";
import { toast } from "@/components/ui/Toaster";

export function SeoPreviewPane({ postId }: { postId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      // Push the current draft to Contentful (unpublished) so Gruve's
      // preview renders the latest content. Skips silently pre-cutover
      // (no CMA token) — preview still works against existing data.
      const sync = await syncBlogDraftToContentful(postId);
      if (!sync.success) {
        setUrl(null);
        toast.error(sync.error);
        return;
      }
      const res = await getSeoPreviewUrl(postId);
      if (res.success) setUrl(res.url);
      else {
        setUrl(null);
        toast.error(res.error);
      }
    });

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <h3 className="text-foreground font-semibold text-sm flex items-center gap-2">
          <Eye className="size-4" /> Preview on Gruve
        </h3>
        {url && (
          <button
            type="button"
            onClick={load}
            disabled={pending}
            className="text-gray-1100 hover:text-foreground transition-colors"
            title="Re-mint preview"
          >
            <RefreshCw
              className={`size-4 ${pending ? "animate-spin" : ""}`}
            />
          </button>
        )}
      </div>

      <div className="p-4">
        {!url ? (
          <button
            type="button"
            onClick={load}
            disabled={pending}
            className="w-full rounded-full bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Minting preview…" : "Open live preview"}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-md border border-border">
              <iframe
                src={url}
                title="Gruve preview"
                className="h-[420px] w-full bg-card"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-end text-xs text-gray-1100 hover:text-foreground transition-colors"
            >
              Open in new tab <ExternalLink className="size-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
