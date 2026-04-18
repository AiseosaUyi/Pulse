"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteStorageFile,
  purgeTenantStorage,
} from "@/lib/actions/storage";
import type { StorageFile } from "@/lib/services/storage-usage";
import { formatBytes } from "@/lib/services/storage-usage";

export function StoragePruneClient({
  tenantSlug,
  files,
}: {
  tenantSlug: string;
  files: StorageFile[];
}) {
  const [busy, startTransition] = useTransition();
  const [purgedPaths, setPurgedPaths] = useState<Set<string>>(new Set());

  if (files.length === 0) return null;

  const visible = files.filter((f) => !purgedPaths.has(f.path));

  const removeOne = (path: string) => {
    if (!window.confirm("Delete this file from storage?\nThe vault row will be kept but marked as purged.")) return;
    startTransition(async () => {
      const res = await deleteStorageFile(tenantSlug, path);
      if (!res.success) {
        alert(res.error);
        return;
      }
      setPurgedPaths((prev) => new Set(prev).add(path));
    });
  };

  const purgeAll = () => {
    if (
      !window.confirm(
        `Delete ALL stored files for ${tenantSlug}?\n\nThis keeps the vault rows (with source URLs) but removes the MP4s and thumbnails from Supabase Storage. Cannot be undone.`
      )
    )
      return;
    startTransition(async () => {
      const res = await purgeTenantStorage(tenantSlug);
      if (!res.success) {
        alert(res.error);
        return;
      }
      alert(`Purged ${res.deleted} file${res.deleted === 1 ? "" : "s"}.`);
      setPurgedPaths(new Set(files.map((f) => f.path)));
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-text-muted font-semibold">
            Largest files · <span className="font-mono">{tenantSlug}</span>
          </h2>
          <p className="text-text-muted text-[11px] mt-0.5">
            Delete individual files below or bulk-purge the whole tenant.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={purgeAll}
          disabled={busy}
          className="text-status-red border-status-red/40 hover:bg-status-red/10"
        >
          <Trash2 size={12} />
          Purge all
        </Button>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-border/30">
            <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Path
            </th>
            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Type
            </th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Size
            </th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Modified
            </th>
            <th className="text-right px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {/* delete */}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((f) => (
            <tr
              key={f.path}
              className="border-b border-border/20 last:border-0 hover:bg-card-hover"
            >
              <td className="px-5 py-2.5 text-xs text-foreground font-mono truncate max-w-[340px]">
                {f.path}
              </td>
              <td className="px-3 py-2.5 text-xs text-text-muted">
                {f.mime ?? "—"}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-secondary text-right tabular-nums">
                {formatBytes(f.sizeBytes)}
              </td>
              <td className="px-3 py-2.5 text-xs text-text-muted text-right">
                {f.updatedAt
                  ? new Date(f.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
              </td>
              <td className="px-5 py-2.5 text-right">
                <button
                  onClick={() => removeOne(f.path)}
                  disabled={busy}
                  className="p-1.5 rounded text-text-muted hover:text-status-red hover:bg-status-red/10 transition-colors"
                  aria-label="Delete file"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
