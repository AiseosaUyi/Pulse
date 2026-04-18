"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET, deleteAsset } from "@/lib/storage/save-asset";

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
  if (!path.startsWith(`${tenantSlug}/`)) {
    return { success: false, error: "Refusing to delete cross-tenant file" };
  }

  await deleteAsset(path).catch((e) => {
    throw new Error(`Storage delete failed: ${e?.message ?? String(e)}`);
  });

  // Clear row pointers. A file can be referenced as stored_path OR
  // thumbnail_path — null whichever matches so the row survives with
  // an "extraction lost" state.
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
 * Bulk purge: delete every file whose path matches the caller's tenant
 * prefix. Dangerous — only use from the "Prune all my files" button.
 */
export async function purgeTenantStorage(
  tenantSlug: string
): Promise<ActionResult<{ deleted: number }>> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .list(tenantSlug, { limit: 1000 });
  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: true, deleted: 0 };

  // list() returns folders (monthly partitions) — walk each one.
  let deleted = 0;
  for (const entry of data) {
    if (entry.metadata?.size != null) {
      // unexpected top-level file; delete directly
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

  // Clear all row pointers for this tenant.
  const supabase = await createClient();
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
