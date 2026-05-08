"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import {
  createResumableSession,
  DriveError,
  ensureFolder,
  type DriveErrorReason,
} from "@/lib/integrations/drive";
import { getActiveAccessToken } from "@/lib/services/drive-connections";
import { createContentItem } from "@/lib/actions/content-pipeline";
import { DEFAULT_CONTENT_SECTIONS } from "@/lib/types/content-pipeline";

const STORAGE_BUCKET = "saved-assets";
const MAX_THUMB_BYTES = 1 * 1024 * 1024; // 1 MB cap for jpeg thumbs

// Upload size cap. Drive itself allows up to 5TB, but >2GB browser
// uploads in a single session URI start hitting timeouts/server reboots.
// Cap at 2GB for MVP — upgrade later if customers complain.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const mintSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sectionSlug: z.string().min(1),
});

export interface MintSessionResult {
  ok: true;
  sessionId: string;
  uri: string;
}

type SessionResult =
  | MintSessionResult
  | { ok: false; error: string; reason?: DriveErrorReason };

/**
 * Mints a Drive resumable upload session URI for the browser to PUT
 * directly to. Persists a content_upload_sessions row so we can
 * recover or clean up on tab close.
 */
export async function mintUploadSession(
  input: z.infer<typeof mintSchema>
): Promise<SessionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No tenant" };

  const parsed = mintSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;

  const admin = createAdminClient();

  let accessToken: string;
  let rootFolderId: string | null;
  try {
    const tok = await getActiveAccessToken(tenant.slug);
    accessToken = tok.accessToken;
    rootFolderId = tok.rootFolderId;
  } catch (err) {
    if (err instanceof DriveError) {
      return { ok: false, error: err.message, reason: err.reason };
    }
    return { ok: false, error: "Failed to authenticate with Drive" };
  }

  // Self-heal /Pulse + section folder. If the row exists with a
  // valid drive_folder_id, use it. Otherwise re-bootstrap the
  // structure (idempotent — Drive find-or-create) and persist.
  // Covers: user moved/deleted the folder in Drive, manual SQL
  // cleanup left a row with null folder, or first upload after
  // reconnect.
  const { data: section } = await admin
    .from("content_sections")
    .select("label, drive_folder_id")
    .eq("tenant_slug", tenant.slug)
    .eq("slug", v.sectionSlug)
    .maybeSingle();

  let parentFolderId = section?.drive_folder_id ?? null;
  let sectionLabel = section?.label;
  if (!sectionLabel) {
    // Section row is missing — reseed it from the defaults
    const def = DEFAULT_CONTENT_SECTIONS.find(
      (s) => s.slug === v.sectionSlug
    );
    sectionLabel = def?.label ?? v.sectionSlug;
  }

  if (!parentFolderId) {
    try {
      // Ensure /Pulse root exists
      let pulseFolderId = rootFolderId;
      if (!pulseFolderId) {
        const pulse = await ensureFolder(accessToken, "Pulse", "root");
        pulseFolderId = pulse.id;
        await admin
          .from("tenant_drive_connections")
          .update({ root_folder_id: pulseFolderId })
          .eq("tenant_slug", tenant.slug);
      }
      // Ensure /Pulse/<Section> exists
      const sectionFolder = await ensureFolder(
        accessToken,
        sectionLabel,
        pulseFolderId
      );
      parentFolderId = sectionFolder.id;
      await admin.from("content_sections").upsert(
        {
          tenant_slug: tenant.slug,
          slug: v.sectionSlug,
          label: sectionLabel,
          drive_folder_id: parentFolderId,
        },
        { onConflict: "tenant_slug,slug" }
      );
    } catch (err) {
      if (err instanceof DriveError) {
        return { ok: false, error: err.message, reason: err.reason };
      }
      return {
        ok: false,
        error: "Couldn't create /Pulse folders in Drive",
      };
    }
  }

  let session: { uri: string };
  try {
    session = await createResumableSession(accessToken, {
      filename: v.filename,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes,
      parentId: parentFolderId,
    });
  } catch (err) {
    if (err instanceof DriveError) {
      return { ok: false, error: err.message, reason: err.reason };
    }
    return { ok: false, error: "Failed to create upload session" };
  }

  const { data: row, error: insErr } = await admin
    .from("content_upload_sessions")
    .insert({
      tenant_slug: tenant.slug,
      user_id: user.id,
      drive_resumable_uri: session.uri,
      filename: v.filename,
      size_bytes: v.sizeBytes,
      section_slug: v.sectionSlug,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    return {
      ok: false,
      error: `Couldn't persist upload session: ${insErr?.message ?? "unknown"}`,
    };
  }

  return { ok: true, sessionId: row.id, uri: session.uri };
}

const finalizeSchema = z.object({
  sessionId: z.string().uuid(),
  driveFileId: z.string().min(1),
  driveMimeType: z.string().nullable().optional(),
  driveSizeBytes: z.number().int().nonnegative().nullable().optional(),
  driveWebViewLink: z.string().url().nullable().optional(),
  thumbnailLink: z.string().url().nullable().optional(),
  // Browser-extracted preview (image OR video frame). Data URL or
  // null. Preferred over thumbnailLink because it's instant —
  // Drive's thumbnailLink is eventually consistent (videos can
  // take minutes).
  localThumbnailDataUrl: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  contentTypeSlug: z.string().nullable().optional(),
  platforms: z.array(z.string()).default([]),
  scheduledAt: z.string().datetime().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

/**
 * Called by the browser once the resumable PUT sequence completes
 * and Drive returns the final file ID. Inserts the content_items
 * row, marks the session complete, kicks off thumbnail caching as
 * a fire-and-forget side effect.
 */
export async function finalizeUpload(
  input: z.infer<typeof finalizeSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No tenant" };

  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;

  // Verify the session belongs to this user
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("content_upload_sessions")
    .select("id, section_slug, status")
    .eq("id", v.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) {
    return { ok: false, error: "Upload session not found" };
  }

  // Drive's resumable PUT response often omits webViewLink. Fetch
  // the full metadata once so the row gets a working "Open in
  // Drive" link from day zero — keeps parity between uploaded
  // and imported items.
  let driveWebViewLink = v.driveWebViewLink ?? null;
  if (!driveWebViewLink) {
    try {
      const tok = await getActiveAccessToken(tenant.slug);
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          v.driveFileId
        )}?fields=webViewLink&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${tok.accessToken}` } }
      );
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as { webViewLink?: string };
        driveWebViewLink = meta.webViewLink ?? null;
      }
    } catch {
      // Best-effort — row creation continues regardless
    }
  }

  // Cache thumbnail (best-effort). Prefer the browser-extracted
  // preview — it's instant and works for videos. Fall back to
  // Drive's thumbnailLink only when no local preview was captured.
  let thumbnailStorageKey: string | null = null;
  if (v.localThumbnailDataUrl) {
    thumbnailStorageKey = await tryCacheLocalThumbnail({
      tenantSlug: tenant.slug,
      driveFileId: v.driveFileId,
      dataUrl: v.localThumbnailDataUrl,
    });
  }
  if (!thumbnailStorageKey && v.thumbnailLink) {
    thumbnailStorageKey = await tryCacheThumbnail({
      tenantSlug: tenant.slug,
      driveFileId: v.driveFileId,
      thumbnailLink: v.thumbnailLink,
    });
  }

  const created = await createContentItem({
    sectionSlug: session.section_slug,
    title: v.title,
    contentTypeSlug: v.contentTypeSlug ?? null,
    platforms: v.platforms as never,
    driveFileId: v.driveFileId,
    driveMimeType: v.driveMimeType ?? null,
    driveSizeBytes: v.driveSizeBytes ?? null,
    driveWebViewLink,
    thumbnailStorageKey,
  });
  if (!created.ok) return created;

  // Apply scheduledAt + assignedTo via update (the create schema
  // doesn't carry these — keeps insert path narrow)
  if (v.scheduledAt || v.assignedTo) {
    await admin
      .from("content_items")
      .update({
        scheduled_at: v.scheduledAt ?? null,
        assigned_to: v.assignedTo ?? null,
      })
      .eq("id", created.data.id);
  }

  await admin
    .from("content_upload_sessions")
    .update({ status: "complete", finalized_at: new Date().toISOString() })
    .eq("id", v.sessionId);

  revalidatePath("/content-vault/pipeline");
  return { ok: true, id: created.data.id };
}

/**
 * Decode a `data:image/jpeg;base64,...` URL coming from the browser
 * preview, validate size, and write to Supabase Storage. Returns
 * the storage key on success or null on any failure.
 */
async function tryCacheLocalThumbnail(args: {
  tenantSlug: string;
  driveFileId: string;
  dataUrl: string;
}): Promise<string | null> {
  try {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(
      args.dataUrl
    );
    if (!match) return null;
    const [, mime, b64] = match;
    const buf = Buffer.from(b64, "base64");
    if (buf.byteLength === 0 || buf.byteLength > MAX_THUMB_BYTES) return null;
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const path = `pipeline-thumbs/${args.tenantSlug}/${args.driveFileId}.${ext}`;
    const admin = createAdminClient();
    const { error } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, buf, { contentType: mime, upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Best-effort fallback when the browser couldn't extract a frame
 * (rare — exotic codecs, very long videos). Pulls Drive's
 * thumbnailLink and caches it to the same bucket.
 */
async function tryCacheThumbnail(args: {
  tenantSlug: string;
  driveFileId: string;
  thumbnailLink: string;
}): Promise<string | null> {
  try {
    const tok = await getActiveAccessToken(args.tenantSlug);
    const res = await fetch(args.thumbnailLink, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `pipeline-thumbs/${args.tenantSlug}/${args.driveFileId}.jpg`;
    const admin = createAdminClient();
    const { error } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, buf, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Cancel/abandon an in-progress session (user closed the modal
 * before upload completed). The Drive file may exist but the row
 * isn't created — reconcile cron will catch orphans later.
 */
export async function abandonUploadSession(
  sessionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("content_upload_sessions")
    .update({ status: "abandoned" })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Returns pending sessions for the current user — the browser uses
 * this on reload to offer "resume upload?" prompts.
 */
export async function listMyPendingUploads(): Promise<
  Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    sectionSlug: string;
    driveResumableUri: string;
    createdAt: string;
  }>
> {
  const user = await getCurrentUser();
  if (!user) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("content_upload_sessions")
    .select(
      "id, filename, size_bytes, section_slug, drive_resumable_uri, created_at"
    )
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data) return [];
  return (
    data as Array<{
      id: string;
      filename: string;
      size_bytes: number;
      section_slug: string;
      drive_resumable_uri: string;
      created_at: string;
    }>
  ).map((r) => ({
    id: r.id,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    sectionSlug: r.section_slug,
    driveResumableUri: r.drive_resumable_uri,
    createdAt: r.created_at,
  }));
}
