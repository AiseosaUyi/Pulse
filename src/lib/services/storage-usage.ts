// Storage usage accounting for the saved-assets bucket. Supabase's free
// plan gives 1 GB; once you cross that they start charging ~$0.021/GB.
// We list all objects in the bucket via the admin client, sum byte
// counts, and group by the leading path segment (which is tenant_slug).
// Cheap: Storage list responses include metadata.size so we don't touch
// the objects themselves.

import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/storage/save-asset";

/** Supabase Free plan cap. User should upgrade or prune past this. */
export const STORAGE_QUOTA_BYTES = 1_000_000_000; // 1 GB
/** Soft-warn threshold (90% full). */
export const STORAGE_WARN_RATIO = 0.9;

export interface StorageFile {
  path: string;
  tenantSlug: string;
  sizeBytes: number;
  mime: string | null;
  updatedAt: string | null;
}

export interface StorageUsage {
  totalBytes: number;
  totalFiles: number;
  quotaBytes: number;
  usedRatio: number;
  warn: boolean;
  perTenant: Array<{ tenantSlug: string; files: number; bytes: number }>;
}

interface RawObject {
  name: string;
  created_at: string | null;
  updated_at: string | null;
  metadata: { size?: number; mimetype?: string } | null;
}

// Supabase's list() paginates — 100 per call by default, 1000 max.
async function listAllRecursive(prefix = ""): Promise<Array<RawObject & { path: string }>> {
  const admin = createAdminClient();
  const PAGE = 1000;
  const all: Array<RawObject & { path: string }> = [];

  // list() returns ONE level at a time: folder entries have no size,
  // file entries do. We recurse into folders.
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: PAGE, offset });
    if (error || !data || data.length === 0) break;

    for (const entry of data as RawObject[]) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Heuristic: folders have null metadata, files have size metadata.
      if (entry.metadata && typeof entry.metadata.size === "number") {
        all.push({ ...entry, path: fullPath });
      } else {
        const nested = await listAllRecursive(fullPath);
        all.push(...nested);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  let files: Array<RawObject & { path: string }> = [];
  try {
    files = await listAllRecursive("");
  } catch {
    // Bucket missing (migration 021 unapplied) or network blip — return
    // an empty usage report rather than breaking the page.
    return {
      totalBytes: 0,
      totalFiles: 0,
      quotaBytes: STORAGE_QUOTA_BYTES,
      usedRatio: 0,
      warn: false,
      perTenant: [],
    };
  }

  const perTenantMap = new Map<string, { files: number; bytes: number }>();
  let totalBytes = 0;
  for (const f of files) {
    const size = f.metadata?.size ?? 0;
    totalBytes += size;
    const tenantSlug = f.path.split("/")[0] ?? "unknown";
    const entry = perTenantMap.get(tenantSlug) ?? { files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += size;
    perTenantMap.set(tenantSlug, entry);
  }

  const perTenant = Array.from(perTenantMap.entries())
    .map(([tenantSlug, v]) => ({ tenantSlug, ...v }))
    .sort((a, b) => b.bytes - a.bytes);

  const usedRatio = totalBytes / STORAGE_QUOTA_BYTES;
  return {
    totalBytes,
    totalFiles: files.length,
    quotaBytes: STORAGE_QUOTA_BYTES,
    usedRatio,
    warn: usedRatio >= STORAGE_WARN_RATIO,
    perTenant,
  };
}

/**
 * Top-N largest files, for the pruning UI. Filters to one tenant by
 * default — callers should NOT expose cross-tenant file listings in
 * the UI since they could reveal other tenants' content paths.
 */
export async function listLargestFiles(
  tenantSlug: string,
  limit = 50
): Promise<StorageFile[]> {
  const files = await listAllRecursive(tenantSlug);
  return files
    .map((f) => ({
      path: f.path,
      tenantSlug: f.path.split("/")[0] ?? tenantSlug,
      sizeBytes: f.metadata?.size ?? 0,
      mime: f.metadata?.mimetype ?? null,
      updatedAt: f.updated_at ?? f.created_at ?? null,
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, limit);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
