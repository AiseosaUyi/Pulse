"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAsset } from "@/lib/storage/save-asset";
import { deleteFromR2 } from "@/lib/storage/r2";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * Delete a single file from storage AND clear the matching
 * saved_content row pointer if one exists. Scoped to the caller's
 * tenant — we refuse to touch paths that don't start with their slug.
 */
export async function deleteStorageFile(
  tenantSlug: string,
  path: string
): Promise<ActionResult> {
  // R2 paths use prefixed form: assets/{slug}/... or legacy: {slug}/...
  const tenantPrefix = path.startsWith("assets/")
    ? `assets/${tenantSlug}/`
    : `${tenantSlug}/`;
  if (!path.startsWith(tenantPrefix)) {
    return { success: false, error: "Refusing to delete cross-tenant file" };
  }

  await deleteAsset(path).catch((e) => {
    throw new Error(`Storage delete failed: ${e?.message ?? String(e)}`);
  });

  // Clear row pointers.
  const supabase = await createClient();
  await supabase
    .from("saved_content")
    .update({ stored_path: null, extraction_status: "extraction_failed", extraction_error: "Media purged from storage" })
    .eq("tenant_slug", tenantSlug)
    .eq("stored_path", path);
  await supabase
    .from("saved_content")
    .update({ thumbnail_path: null })
    .eq("tenant_slug", tenantSlug)
    .eq("thumbnail_path", path);

  revalidatePath("/content-vault");
  revalidatePath("/settings/storage");
  return { success: true };
}

/**
 * Bulk purge: delete every R2 object under the caller's tenant prefix.
 * Also walks legacy Supabase Storage if any un-migrated files remain.
 */
export async function purgeTenantStorage(
  tenantSlug: string
): Promise<ActionResult<{ deleted: number }>> {
  let deleted = 0;

  // ── R2: list and delete all objects under assets/{tenant}/ ──────────
  // R2 doesn't have a native list API in the S3 SDK without paginating
  // via ListObjectsV2. For now we use the DB as the authoritative list —
  // every stored path is recorded in saved_content.stored_path.
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("saved_content")
    .select("stored_path, thumbnail_path")
    .eq("tenant_slug", tenantSlug)
    .not("stored_path", "is", null);

  if (rows) {
    const keys = new Set<string>();
    for (const row of rows) {
      if (row.stored_path) keys.add(row.stored_path);
      if (row.thumbnail_path) keys.add(row.thumbnail_path);
    }
    for (const key of keys) {
      try {
        await deleteFromR2(key);
        deleted += 1;
      } catch {
        // Best-effort — don't block the purge
      }
    }
  }

  // ── Legacy Supabase Storage fallback ────────────────────────────────
  const STORAGE_BUCKET = "saved-assets";
  const admin = createAdminClient();
  const { data } = await admin.storage.from(STORAGE_BUCKET).list(tenantSlug, { limit: 1000 });
  if (data && data.length > 0) {
    for (const entry of data) {
      if (entry.metadata?.size != null) {
        await admin.storage.from(STORAGE_BUCKET).remove([`${tenantSlug}/${entry.name}`]);
        deleted += 1;
        continue;
      }
      const { data: children } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(`${tenantSlug}/${entry.name}`, { limit: 1000 });
      if (!children || children.length === 0) continue;
      const paths = children.map((c) => `${tenantSlug}/${entry.name}/${c.name}`);
      await admin.storage.from(STORAGE_BUCKET).remove(paths);
      deleted += paths.length;
    }
  }

  // Clear all row pointers for this tenant.
  await supabase
    .from("saved_content")
    .update({
      stored_path: null,
      thumbnail_path: null,
      extraction_status: "extraction_failed",
      extraction_error: "Purged from storage",
    })
    .eq("tenant_slug", tenantSlug)
    .not("stored_path", "is", null);

  revalidatePath("/content-vault");
  revalidatePath("/settings/storage");
  return { success: true, deleted };
}
