"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import { importFromDriveUrl } from "@/lib/actions/drive-import";
import type { ContentSection } from "@/lib/types/content-pipeline";

interface LinkRow {
  id: number;
  url: string;
  state: "pending" | "running" | "ok" | "failed";
  imported?: number;
  error?: string;
}

let nextLinkId = 1;
const newRow = (): LinkRow => ({
  id: nextLinkId++,
  url: "",
  state: "pending",
});

export function ImportFromDriveButton({
  sections,
  defaultSectionSlug,
}: {
  sections: ContentSection[];
  defaultSectionSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LinkRow[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  // Section is implicit — single-section MVP. If a tenant ever has
  // more than one section, fall back to the active one passed in.
  const sectionSlug = defaultSectionSlug;
  void sections;

  const reset = () => {
    setRows([newRow()]);
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (id: number) =>
    setRows((prev) =>
      prev.length > 1 ? prev.filter((r) => r.id !== id) : prev
    );
  const updateUrl = (id: number, url: string) =>
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, url, state: "pending", error: undefined } : r
      )
    );

  const submit = async () => {
    const candidates = rows.filter((r) => r.url.trim() !== "");
    if (candidates.length === 0) return;
    setBusy(true);
    let totalImported = 0;
    let okLinks = 0;
    let failedLinks = 0;
    for (const row of candidates) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, state: "running" } : r
        )
      );
      const res = await importFromDriveUrl({
        url: row.url.trim(),
        sectionSlug,
      });
      if (res.ok) {
        okLinks++;
        totalImported += res.importedCount;
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, state: "ok", imported: res.importedCount }
              : r
          )
        );
      } else {
        failedLinks++;
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, state: "failed", error: res.error } : r
          )
        );
      }
    }
    setBusy(false);

    if (okLinks > 0 && failedLinks === 0) {
      toast.success(
        `Imported ${totalImported} file${totalImported === 1 ? "" : "s"}`
      );
      setOpen(false);
      reset();
      router.refresh();
    } else if (okLinks > 0) {
      toast.error(
        `${failedLinks} link${failedLinks === 1 ? "" : "s"} failed`,
        `Imported ${totalImported} file${
          totalImported === 1 ? "" : "s"
        } from the rest`
      );
      router.refresh();
    } else {
      toast.error("No files imported");
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  const validCount = rows.filter((r) => r.url.trim() !== "").length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Link2 size={14} className="mr-1.5" />
        Import drive
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Import from Drive
            </h2>
            <p className="text-text-muted text-sm mb-4">
              Paste Drive file or folder links — Pulse references the files
              in place. Add as many as you need.
            </p>

            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {rows.map((row, idx) => (
                <div key={row.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder="https://drive.google.com/..."
                      value={row.url}
                      onChange={(e) => updateUrl(row.id, e.target.value)}
                      autoFocus={idx === 0}
                      disabled={busy}
                    />
                    {row.state === "running" ? (
                      <p className="text-xs text-text-muted mt-1 flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" />
                        Importing…
                      </p>
                    ) : row.state === "ok" ? (
                      <p className="text-xs text-status-green mt-1">
                        Imported {row.imported} file
                        {row.imported === 1 ? "" : "s"}
                      </p>
                    ) : row.state === "failed" ? (
                      <p className="text-xs text-red-600 mt-1">{row.error}</p>
                    ) : null}
                  </div>
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={busy}
                      className="p-2 rounded-md text-text-muted hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                      aria-label="Remove link"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addRow}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-40"
            >
              <Plus size={12} />
              Add another link
            </button>

            <div className="flex justify-end gap-2 mt-5">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || validCount === 0}
                onClick={submit}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                ) : null}
                Import {validCount > 1 ? `all ${validCount}` : ""}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
