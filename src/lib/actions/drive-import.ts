"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getActiveAccessToken } from "@/lib/services/drive-connections";
import {
  DriveError,
  type DriveErrorReason,
} from "@/lib/integrations/drive";
import { parseDriveShareUrl } from "@/lib/content-pipeline/drive-url";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

const importSchema = z.object({
  url: z.string().url(),
  sectionSlug: z.string().min(1),
});

interface DriveFileMetaLite {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  trashed?: boolean;
}

async function fetchMeta(
  accessToken: string,
  fileId: string
): Promise<DriveFileMetaLite> {
  const fields =
    "id,name,mimeType,size,webViewLink,thumbnailLink,trashed";
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${fields}&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 401)
    throw new DriveError("Drive auth expired", "auth_revoked", 401);
  if (res.status === 403)
    throw new DriveError("Permission denied", "permission_denied", 403);
  if (res.status === 404)
    throw new DriveError(
      // The drive.file scope is too narrow to see arbitrary files
      // the user pastes. drive.readonly fixes this, but the user
      // needs to reconnect to grant the new scope.
      "Drive can't see this file. If you just enabled imports, disconnect + reconnect Drive in Settings → Integrations to grant read access.",
      "file_missing",
      404
    );
  if (!res.ok)
    throw new DriveError(`Drive returned ${res.status}`, "fetch_failed", res.status);
  return (await res.json()) as DriveFileMetaLite;
}

async function listFolderChildren(
  accessToken: string,
  folderId: string
): Promise<DriveFileMetaLite[]> {
  const out: DriveFileMetaLite[] = [];
  let pageToken: string | undefined;
  let total = 0;
  const MAX = 200; // cap per import job — see edge-case handling
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields:
        "nextPageToken, files(id,name,mimeType,size,webViewLink,thumbnailLink,trashed)",
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401)
      throw new DriveError("Drive auth expired", "auth_revoked", 401);
    if (res.status === 403)
      throw new DriveError("Permission denied", "permission_denied", 403);
    if (!res.ok)
      throw new DriveError(`Drive returned ${res.status}`, "fetch_failed", res.status);
    const json = (await res.json()) as {
      files?: DriveFileMetaLite[];
      nextPageToken?: string;
    };
    for (const f of json.files ?? []) {
      if (f.mimeType === "application/vnd.google-apps.folder") continue;
      if (f.trashed) continue;
      out.push(f);
      total++;
      if (total >= MAX) return out;
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export async function importFromDriveUrl(
  input: z.infer<typeof importSchema>
): Promise<
  | { ok: true; jobId: string; importedCount: number }
  | { ok: false; error: string; reason?: DriveErrorReason }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No tenant" };
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const ref = parseDriveShareUrl(v.url);
  if (!ref) {
    return {
      ok: false,
      error: "Couldn't parse this URL — paste a Drive file or folder link",
    };
  }

  const admin = createAdminClient();

  // Create job row first so failures are persisted
  const { data: job, error: jobErr } = await admin
    .from("drive_import_jobs")
    .insert({
      tenant_slug: tenant.slug,
      source_url: v.url,
      kind: ref.kind,
      status: "running",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return {
      ok: false,
      error: `Couldn't start import: ${jobErr?.message ?? "unknown"}`,
    };
  }

  let accessToken: string;
  try {
    const tok = await getActiveAccessToken(tenant.slug);
    accessToken = tok.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed";
    await admin
      .from("drive_import_jobs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return {
      ok: false,
      error: message,
      reason:
        err instanceof DriveError ? err.reason : undefined,
    };
  }

  try {
    const items =
      ref.kind === "file"
        ? [await fetchMeta(accessToken, ref.id)]
        : await listFolderChildren(accessToken, ref.id);

    if (items.length === 0) {
      await admin
        .from("drive_import_jobs")
        .update({
          status: "complete",
          imported_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return { ok: true, jobId: job.id, importedCount: 0 };
    }

    // Insert content_items in bulk. Skip duplicates (same drive_file_id +
    // tenant) by querying existing IDs first.
    const driveIds = items.map((i) => i.id);
    const { data: existing } = await admin
      .from("content_items")
      .select("drive_file_id")
      .eq("tenant_slug", tenant.slug)
      .in("drive_file_id", driveIds);
    const existingSet = new Set(
      ((existing as Array<{ drive_file_id: string }> | null) ?? []).map(
        (r) => r.drive_file_id
      )
    );

    const rows = items
      .filter((i) => !existingSet.has(i.id))
      .map((i) => ({
        tenant_slug: tenant.slug,
        section_slug: v.sectionSlug,
        title: i.name.replace(/\.[^/.]+$/, ""),
        platforms: [],
        drive_file_id: i.id,
        drive_mime_type: i.mimeType,
        drive_size_bytes: i.size ? parseInt(i.size, 10) : null,
        drive_web_view_link: i.webViewLink ?? null,
        uploaded_by: user.id,
      }));

    let importedCount = 0;
    if (rows.length > 0) {
      const { error: insErr } = await admin.from("content_items").insert(rows);
      if (insErr) {
        await admin
          .from("drive_import_jobs")
          .update({
            status: "failed",
            error: insErr.message,
            imported_count: 0,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        return { ok: false, error: insErr.message };
      }
      importedCount = rows.length;
    }

    await admin
      .from("drive_import_jobs")
      .update({
        status: "complete",
        imported_count: importedCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    revalidatePath("/content-vault/pipeline");
    return { ok: true, jobId: job.id, importedCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    const reason = err instanceof DriveError ? err.reason : undefined;
    await admin
      .from("drive_import_jobs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { ok: false, error: message, reason };
  }
}
