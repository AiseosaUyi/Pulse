"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectPlatform } from "@/lib/scrape/extract-platform";
import {
  resolveTikTok,
  TikTokResolveError,
} from "@/lib/scrape/tiktok-downloader";
import {
  fetchBytes,
  uploadAsset,
  deleteAsset,
  publicUrlFor,
  SaveAssetError,
} from "@/lib/storage/save-asset";
import type {
  ExtractionStatus,
  SavedContentStatus,
} from "@/lib/types/saved-content";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

const THUMBNAIL_EMOJI: Record<string, string> = {
  tiktok: "🎵",
  instagram: "📸",
  youtube: "▶️",
  twitter: "🐦",
  facebook: "📘",
  linkedin: "💼",
  manual: "🔖",
};

interface SaveInput {
  title: string;
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
  intelCardId?: string | null;
  trendScoutId?: string | null;
  thumbnailEmoji?: string | null;
  notes?: string | null;
  tags?: string[];
  bestFor?: string[];
}

/**
 * Raw save — no extraction, just a row. Used when the caller already has
 * all the fields (e.g. converting a trend scout into a vault item).
 */
export async function saveContent(
  tenantSlug: string,
  input: SaveInput
): Promise<ActionResult<{ id: string }>> {
  const title = input.title?.trim();
  if (!title) return { success: false, error: "Title is required" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_content")
    .insert({
      tenant_slug: tenantSlug,
      title,
      source_platform: input.sourcePlatform ?? null,
      source_url: input.sourceUrl ?? null,
      intel_card_id: input.intelCardId ?? null,
      trend_scout_id: input.trendScoutId ?? null,
      thumbnail_emoji: input.thumbnailEmoji ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      best_for: input.bestFor ?? [],
      status: "new",
      extraction_status: "link_only",
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath("/content-vault");
  return { success: true, id: data.id };
}

export interface ExtractResult {
  id: string;
  extractionStatus: ExtractionStatus;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  message: string;
}

/**
 * URL intake: classify platform, resolve the media URL, pull the bytes,
 * upload to storage, insert (or dedup) the saved_content row. For
 * unsupported platforms or resolve failures, saves link-only so the
 * user never loses the URL.
 */
export async function saveContentFromUrl(
  tenantSlug: string,
  rawUrl: string
): Promise<ActionResult<ExtractResult>> {
  const url = rawUrl.trim();
  if (!url) return { success: false, error: "URL is required" };

  const detection = detectPlatform(url);
  const thumbnailEmoji = THUMBNAIL_EMOJI[detection.platform] ?? "🔖";

  // Fast dedup by (tenant, source_url) — most common case.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("saved_content")
    .select("id, extraction_status, stored_path, thumbnail_path")
    .eq("tenant_slug", tenantSlug)
    .eq("source_url", url)
    .maybeSingle();

  if (existing) {
    return {
      success: true,
      id: existing.id,
      extractionStatus: existing.extraction_status as ExtractionStatus,
      publicUrl: publicUrlFor(existing.stored_path),
      thumbnailUrl: publicUrlFor(existing.thumbnail_path),
      message: "Already saved — reopened existing entry.",
    };
  }

  // Link-only path (platform we can't extract yet).
  if (!detection.canExtract) {
    const fallbackTitle = fallbackTitleFromUrl(url);
    const row = await insertLinkOnly(admin, tenantSlug, {
      title: fallbackTitle,
      sourceUrl: url,
      sourcePlatform: detection.platform,
      thumbnailEmoji,
      extractionError: null,
      reason: detection.linkOnlyReason ?? "Saved as a link.",
    });
    revalidatePath("/content-vault");
    return row;
  }

  // TikTok extraction path.
  if (detection.platform === "tiktok") {
    return await extractTikTokAndSave(tenantSlug, url, thumbnailEmoji);
  }

  // Shouldn't reach (canExtract=true only for tiktok today), but fail closed.
  const row = await insertLinkOnly(admin, tenantSlug, {
    title: fallbackTitleFromUrl(url),
    sourceUrl: url,
    sourcePlatform: detection.platform,
    thumbnailEmoji,
    extractionError: "No extractor wired up for this platform",
    reason: "Saved as a link.",
  });
  revalidatePath("/content-vault");
  return row;
}

async function extractTikTokAndSave(
  tenantSlug: string,
  url: string,
  thumbnailEmoji: string
): Promise<ActionResult<ExtractResult>> {
  const admin = createAdminClient();

  // 1. Resolve via tikwm.
  let resolved;
  try {
    resolved = await resolveTikTok(url);
  } catch (err) {
    const message =
      err instanceof TikTokResolveError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const row = await insertLinkOnly(admin, tenantSlug, {
      title: fallbackTitleFromUrl(url),
      sourceUrl: url,
      sourcePlatform: "tiktok",
      thumbnailEmoji,
      extractionError: `tiktok resolve failed: ${message}`,
      reason: `Couldn't extract the video. Saved as a link — ${message}`,
    });
    revalidatePath("/content-vault");
    return row;
  }

  // 2. Fetch bytes (with SSRF guard + 50MB cap).
  let asset;
  try {
    asset = await fetchBytes(resolved.videoUrl);
  } catch (err) {
    const message = err instanceof SaveAssetError ? err.message : String(err);
    const row = await insertLinkOnly(admin, tenantSlug, {
      title: resolved.title ?? fallbackTitleFromUrl(url),
      sourceUrl: url,
      sourcePlatform: "tiktok",
      thumbnailEmoji,
      authorHandle: resolved.authorHandle,
      durationSec: resolved.durationSec,
      extractionError: `fetch failed: ${message}`,
      reason: `Couldn't download the video. Saved as a link — ${message}`,
    });
    revalidatePath("/content-vault");
    return row;
  }

  // 3. Content-hash dedup — same video under different URLs.
  const { data: hashMatch } = await admin
    .from("saved_content")
    .select("id, stored_path, thumbnail_path")
    .eq("tenant_slug", tenantSlug)
    .eq("content_hash", asset.sha256)
    .maybeSingle();

  if (hashMatch?.stored_path) {
    return {
      success: true,
      id: hashMatch.id,
      extractionStatus: "extracted",
      publicUrl: publicUrlFor(hashMatch.stored_path),
      thumbnailUrl: publicUrlFor(hashMatch.thumbnail_path),
      message: "Same video already in vault — reopened existing entry.",
    };
  }

  // 4. Upload asset.
  let uploaded;
  try {
    uploaded = await uploadAsset(tenantSlug, asset);
  } catch (err) {
    const message = err instanceof SaveAssetError ? err.message : String(err);
    const row = await insertLinkOnly(admin, tenantSlug, {
      title: resolved.title ?? fallbackTitleFromUrl(url),
      sourceUrl: url,
      sourcePlatform: "tiktok",
      thumbnailEmoji,
      authorHandle: resolved.authorHandle,
      durationSec: resolved.durationSec,
      extractionError: `upload failed: ${message}`,
      reason: `Couldn't save the video to storage. Saved as a link — ${message}`,
    });
    revalidatePath("/content-vault");
    return row;
  }

  // 5. Thumbnail upload (best-effort, doesn't block success).
  let thumbnailPath: string | null = null;
  if (resolved.thumbnailUrl) {
    try {
      const thumb = await fetchBytes(resolved.thumbnailUrl);
      const thumbUpload = await uploadAsset(tenantSlug, thumb, {
        suffix: "thumb",
      });
      thumbnailPath = thumbUpload.storagePath;
    } catch {
      // Non-fatal — the main video saved fine.
    }
  }

  // 6. Insert the row. If this fails, clean up the uploaded file to
  // avoid orphans.
  const title = resolved.title ?? fallbackTitleFromUrl(url);
  const tags = resolved.hashtags.slice(0, 10);

  const { data: row, error: rowError } = await admin
    .from("saved_content")
    .insert({
      tenant_slug: tenantSlug,
      title,
      source_platform: "tiktok",
      source_url: url,
      thumbnail_emoji: thumbnailEmoji,
      tags,
      best_for: [],
      status: "new" as SavedContentStatus,
      extraction_status: "extracted" as ExtractionStatus,
      stored_path: uploaded.storagePath,
      stored_mime: uploaded.mime,
      file_size_bytes: uploaded.sizeBytes,
      content_hash: uploaded.sha256,
      thumbnail_path: thumbnailPath,
      author_handle: resolved.authorHandle,
      duration_sec: resolved.durationSec,
    })
    .select("id, stored_path, thumbnail_path")
    .single();

  if (rowError || !row) {
    // Orphan cleanup — best effort.
    await deleteAsset(uploaded.storagePath).catch(() => {});
    if (thumbnailPath) await deleteAsset(thumbnailPath).catch(() => {});
    return { success: false, error: rowError?.message ?? "Insert failed" };
  }

  revalidatePath("/content-vault");
  return {
    success: true,
    id: row.id,
    extractionStatus: "extracted",
    publicUrl: publicUrlFor(row.stored_path),
    thumbnailUrl: publicUrlFor(row.thumbnail_path),
    message: "Saved to vault — video downloaded without watermark.",
  };
}

async function insertLinkOnly(
  admin: ReturnType<typeof createAdminClient>,
  tenantSlug: string,
  fields: {
    title: string;
    sourceUrl: string;
    sourcePlatform: string;
    thumbnailEmoji: string;
    authorHandle?: string | null;
    durationSec?: number | null;
    extractionError: string | null;
    reason: string;
  }
): Promise<ActionResult<ExtractResult>> {
  const { data, error } = await admin
    .from("saved_content")
    .insert({
      tenant_slug: tenantSlug,
      title: fields.title,
      source_platform: fields.sourcePlatform,
      source_url: fields.sourceUrl,
      thumbnail_emoji: fields.thumbnailEmoji,
      author_handle: fields.authorHandle ?? null,
      duration_sec: fields.durationSec ?? null,
      tags: [],
      best_for: [],
      status: "new",
      extraction_status: fields.extractionError ? "extraction_failed" : "link_only",
      extraction_error: fields.extractionError,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }
  return {
    success: true,
    id: data.id,
    extractionStatus: fields.extractionError ? "extraction_failed" : "link_only",
    publicUrl: null,
    thumbnailUrl: null,
    message: fields.reason,
  };
}

function fallbackTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const tail = u.pathname.replace(/^\/+/, "").split("/").slice(0, 3).join(" · ");
    return tail ? `${host} · ${tail}` : host;
  } catch {
    return "Saved link";
  }
}

export async function updateSavedContentStatus(
  tenantSlug: string,
  id: string,
  status: SavedContentStatus
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("saved_content")
    .update({ status })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-vault");
  return { success: true };
}

export async function deleteSavedContent(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  // Best-effort: remove the file from storage before the row. If the file
  // delete fails (already gone, etc.) we still delete the row.
  const { data: row } = await supabase
    .from("saved_content")
    .select("stored_path, thumbnail_path")
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (row?.stored_path) await deleteAsset(row.stored_path).catch(() => {});
  if (row?.thumbnail_path)
    await deleteAsset(row.thumbnail_path).catch(() => {});

  const { error } = await supabase
    .from("saved_content")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-vault");
  return { success: true };
}
