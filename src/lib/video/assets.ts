// Video asset storage. Uploads reference inputs + generated clips into the
// public `generated-videos` bucket (Pulse-owned, so PicsArt can fetch them by
// URL) and registers a video_assets row. Mirrors save-asset.ts but for the
// video bucket — kept separate so the shared util is untouched.

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VideoAsset } from "@/lib/types/video";

const BUCKET = "generated-videos";

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
};

export type AssetRole = VideoAsset["role"];
export type AssetKind = VideoAsset["kind"];

interface RegisterInput {
  tenantSlug: string;
  bytes: Uint8Array;
  mime: string;
  kind: AssetKind;
  role: AssetRole;
  createdBy?: string | null;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
}

export interface StoredVideoAsset {
  id: string;
  storageUrl: string;
  contentHash: string;
}

// Upload raw bytes and register the asset. Content-addressed (sha256) so the
// same bytes dedupe to one storage object + one row per tenant.
export async function storeVideoAsset(
  input: RegisterInput
): Promise<StoredVideoAsset> {
  const admin = createAdminClient();
  const sha = createHash("sha256").update(input.bytes).digest("hex");
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const ext = EXT[input.mime] ?? "bin";
  const path = `${input.tenantSlug}/${month}/${sha}.${ext}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: input.mime,
    upsert: true,
  });
  if (upErr) throw new Error(`Video upload failed: ${upErr.message}`);

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const storageUrl = pub.publicUrl;

  // Dedupe row by (tenant, content_hash).
  const { data: existing } = await admin
    .from("video_assets")
    .select("id")
    .eq("tenant_slug", input.tenantSlug)
    .eq("content_hash", sha)
    .eq("role", input.role)
    .maybeSingle();
  if (existing) {
    return { id: existing.id as string, storageUrl, contentHash: sha };
  }

  const { data: row, error } = await admin
    .from("video_assets")
    .insert({
      tenant_slug: input.tenantSlug,
      kind: input.kind,
      role: input.role,
      storage_url: storageUrl,
      content_hash: sha,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_s: input.durationS ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Asset registration failed");
  return { id: row.id as string, storageUrl, contentHash: sha };
}

// Fetch a provider result URL (e.g. a finished clip / last frame) into our
// storage so it's permanent + servable, and register it.
export async function fetchAndStoreVideoAsset(
  url: string,
  meta: Omit<RegisterInput, "bytes">
): Promise<StoredVideoAsset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch asset failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const mime = meta.mime || res.headers.get("content-type") || "video/mp4";
  return storeVideoAsset({ ...meta, mime, bytes: buf });
}
