"use client";

// Programmatic download. Native <a download> would technically work,
// but the request hands off to the browser immediately and we can't
// signal "in progress" to the user — multiple clicks send multiple
// requests. This button fetches the file, swaps the icon for a
// spinner while in flight, then materialises a blob URL the browser
// downloads. Single click → single request → visible state.

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/Toaster";

interface Props {
  fileId: string;
  filename?: string;
  title?: string;
}

export function DownloadButton({ fileId, filename, title = "Download" }: Props) {
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/integrations/drive/download?fileId=${encodeURIComponent(fileId)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(
          "Download failed",
          (body as { error?: string }).error ?? `Server returned ${res.status}`
        );
        return;
      }
      // Pull the suggested filename out of Content-Disposition so the
      // download lands with the right extension regardless of the
      // browser's interpretation.
      let pickedName = filename;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(cd);
      if (match) pickedName = match[1];

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      if (pickedName) a.download = pickedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        "Download failed",
        err instanceof Error ? err.message : "Network error"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="p-1.5 rounded-md text-text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-wait"
      title={title}
      aria-label={title}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Download size={14} />
      )}
    </button>
  );
}
