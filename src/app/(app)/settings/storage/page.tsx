import { getCurrentTenant } from "@/lib/auth";
import Link from "next/link";
import { HardDrive } from "lucide-react";
import {
  getStorageUsage,
  listLargestFiles,
  formatBytes,
  STORAGE_QUOTA_BYTES,
} from "@/lib/services/storage-usage";
import { StoragePruneClient } from "./client";
import { SettingsPageHeading } from "../_shared";

export default async function StorageSettingsPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [usage, largest] = await Promise.all([
    getStorageUsage(tenantSlug),
    listLargestFiles(tenantSlug, 100),
  ]);

  const pct = Math.min(100, Math.round(usage.usedRatio * 100));
  const barTone =
    pct >= 90 ? "bg-status-red" : pct >= 75 ? "bg-status-yellow" : "bg-status-green";

  return (
    <div className="max-w-[900px]">
      <SettingsPageHeading
        icon={HardDrive}
        title="Storage"
        subtitle="Videos and thumbnails extracted from your content. Delete old files here to free up space."
      />

      {/* Overall usage */}
      <div className="bg-card rounded-xl p-5 border border-border/50 mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs uppercase tracking-wide text-text-muted font-semibold">
            Total used
          </p>
          <p className="text-sm text-foreground">
            <span className="font-semibold">{formatBytes(usage.totalBytes)}</span>
            <span className="text-text-muted"> of {formatBytes(STORAGE_QUOTA_BYTES)}</span>
          </p>
        </div>
        <div className="h-3 bg-border/50 rounded-full overflow-hidden">
          <div
            className={`h-full ${barTone} transition-all`}
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
          <span>{pct}% full</span>
          <span>·</span>
          <span>{usage.totalFiles} files</span>
        </div>
      </div>

      {/* Largest files in current tenant */}
      <StoragePruneClient tenantSlug={tenantSlug} files={largest} />

      {largest.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-foreground font-semibold mb-1">
            Nothing stored for <span className="font-mono">{tenantSlug}</span> yet
          </p>
          <p className="text-text-muted text-sm max-w-[400px] mx-auto">
            Extract something from a TikTok link in{" "}
            <Link href="/content-vault" className="text-primary-500 hover:underline">
              Content Vault
            </Link>{" "}
            to see files here.
          </p>
        </div>
      )}
    </div>
  );
}
