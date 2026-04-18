import Link from "next/link";
import { HardDrive, AlertTriangle } from "lucide-react";
import { formatBytes } from "@/lib/services/storage-usage";
import type { StorageUsage } from "@/lib/services/storage-usage";

// Compact storage usage widget — lives at the top of /content-vault.
// Green when < 75% full, yellow 75-89%, red at 90%+. Clicking "Manage"
// takes the user to /settings/storage where they can prune files.

export function StorageMeter({ usage }: { usage: StorageUsage }) {
  const pct = Math.min(100, Math.round(usage.usedRatio * 100));
  const tone =
    pct >= 90 ? "red" : pct >= 75 ? "yellow" : "green";

  const barClass =
    tone === "red"
      ? "bg-status-red"
      : tone === "yellow"
        ? "bg-status-yellow"
        : "bg-status-green";

  return (
    <div className="bg-card rounded-xl p-4 border border-border/50 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-sidebar border border-border flex items-center justify-center">
          <HardDrive size={14} className="text-text-muted" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Supabase Storage
          </p>
          <p className="text-sm font-semibold text-foreground">
            {formatBytes(usage.totalBytes)}{" "}
            <span className="text-text-muted font-normal">
              / {formatBytes(usage.quotaBytes)}
            </span>
          </p>
        </div>
      </div>

      <div className="flex-1 min-w-[160px]">
        <div className="h-2 bg-border/50 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${barClass} transition-all`}
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
        <p className="text-text-muted text-[11px] mt-1">
          {pct}% used · {usage.totalFiles} file
          {usage.totalFiles === 1 ? "" : "s"}
        </p>
      </div>

      {usage.warn && (
        <div className="flex items-center gap-1.5 text-status-red text-xs font-medium">
          <AlertTriangle size={12} />
          <span>Near limit — prune files</span>
        </div>
      )}

      <Link
        href="/settings/storage"
        className="shrink-0 text-xs text-primary-500 hover:underline"
      >
        Manage →
      </Link>
    </div>
  );
}
