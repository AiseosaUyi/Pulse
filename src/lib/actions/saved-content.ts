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
  resolveViaCobalt,
  CobaltResolveError,
} from "@/lib/scrape/cobalt-downloader";
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
  /** Pre-flight proxy URL the client hits to trigger the browser download. */
  downloadProxyUrl: string | null;
  /** Cobalt/tikwm-suggested filename, slugified client-side for the `download` attr. */
  downloadFilename: string | null;
  /** Public URL of the thumbnail stored in Supabase (if we have one). */
  thumbnailUrl: string | null;
  message: string;
}

/**
 * URL intake — "lean storage" flow:
 *   1. Classify the URL (tikwm for TikTok, cobalt for IG/YT/X/FB).
 *   2. Resolve it to a fresh media URL + metadata.
 *   3. Upload ONLY the thumbnail (~50 KB) to Supabase Storage. The video
 *      itself never touches our bucket — the client auto-downloads it
 *      straight to the user's device via the /api/vault/download/[id]
 *      proxy, which re-resolves the source on demand (cobalt URLs
 *      expire in a few hours, so re-resolution happens on every hit).
 *   4. Save a row carrying source_url + thumbnail_path + metadata so
 *      "Download again" works forever.
 *
 * Storage stays tiny regardless of how many videos the user grabs.
 */
export async function saveContentFromUrl(
  tenantSlug: string,
  rawUrl: string
): Promise<ActionResult<ExtractResult>> {
  const url = rawUrl.trim();
  if (!url) return { success: false, error: "URL is required" };

  const detection = detectPlatform(url);
  const thumbnailEmoji = THUMBNAIL_EMOJI[detection.platform] ?? "🔖";

  // Fast dedup by (tenant, source_url) — same link twice = same row.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("saved_content")
    .select("id, extraction_status, thumbnail_path, title")
    .eq("tenant_slug", tenantSlug)
    .eq("source_url", url)
    .maybeSingle();

  if (existing) {
    const extractionStatus = existing.extraction_status as ExtractionStatus;
    return {
      success: true,
      id: existing.id,
      extractionStatus,
      downloadProxyUrl:
        extractionStatus === "extracted" ? downloadProxyFor(existing.id) : null,
      downloadFilename: slugFilename(existing.title ?? "video", "mp4"),
      thumbnailUrl: publicUrlFor(existing.thumbnail_path),
      message: "Already in vault — re-triggering download.",
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
  if (detection.extractor === "tikwm") {
    return await extractTikTokAndSave(tenantSlug, url, thumbnailEmoji);
  }

  // Instagram / YouTube / Twitter / Facebook via self-hosted cobalt.
  if (detection.extractor === "cobalt") {
    return await extractViaCobaltAndSave(
      tenantSlug,
      url,
      detection.platform,
      thumbnailEmoji
    );
  }

  // canExtract was true but no extractor matched — shouldn't happen,
  // fail closed so the user still keeps the link.
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

  // 1. Resolve via tikwm — gets us the video URL, thumbnail URL,
  // title, author, duration. Video bytes are NOT fetched here.
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

  // 2. Thumbnail upload — best-effort, ~50 KB. If this fails the row
  // still saves as "extracted" so the user can still re-download.
  let thumbnailPath: string | null = null;
  if (resolved.thumbnailUrl) {
    try {
      const thumb = await fetchBytes(resolved.thumbnailUrl);
      const thumbUpload = await uploadAsset(tenantSlug, thumb, {
        suffix: "thumb",
      });
      thumbnailPath = thumbUpload.storagePath;
    } catch {
      // Non-fatal.
    }
  }

  // 3. Insert the row. Note: stored_path stays null — video is not in
  // our bucket, the client will download it directly via the proxy.
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
      thumbnail_path: thumbnailPath,
      author_handle: resolved.authorHandle,
      duration_sec: resolved.durationSec,
    })
    .select("id, thumbnail_path, title")
    .single();

  if (rowError || !row) {
    if (thumbnailPath) await deleteAsset(thumbnailPath).catch(() => {});
    return { success: false, error: rowError?.message ?? "Insert failed" };
  }

  revalidatePath("/content-vault");
  return {
    success: true,
    id: row.id,
    extractionStatus: "extracted",
    downloadProxyUrl: downloadProxyFor(row.id),
    downloadFilename: slugFilename(row.title ?? title, "mp4"),
    thumbnailUrl: publicUrlFor(row.thumbnail_path),
    message: "Extracted — your device is downloading the MP4 now.",
  };
}

async function extractViaCobaltAndSave(
  tenantSlug: string,
  url: string,
  platform: string,
  thumbnailEmoji: string
): Promise<ActionResult<ExtractResult>> {
  const admin = createAdminClient();

  // Resolve via cobalt — validates the URL + gets us the filename hint.
  // Video bytes are NOT fetched here; the client downloads directly.
  let resolved;
  try {
    resolved = await resolveViaCobalt(url);
  } catch (err) {
    const message =
      err instanceof CobaltResolveError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const row = await insertLinkOnly(admin, tenantSlug, {
      title: fallbackTitleFromUrl(url),
      sourceUrl: url,
      sourcePlatform: platform,
      thumbnailEmoji,
      extractionError: `cobalt resolve failed: ${message}`,
      reason: `Couldn't extract. Saved as a link — ${message}`,
    });
    revalidatePath("/content-vault");
    return row;
  }

  // Cobalt doesn't hand back a thumbnail separately, so for IG/YT/X/FB
  // we keep the emoji placeholder. A future enhancement: fetch the
  // source page's OpenGraph image to fill this in.
  const title = resolved.filename ?? fallbackTitleFromUrl(url);

  const { data: row, error: rowError } = await admin
    .from("saved_content")
    .insert({
      tenant_slug: tenantSlug,
      title,
      source_platform: platform,
      source_url: url,
      thumbnail_emoji: thumbnailEmoji,
      tags: [],
      best_for: [],
      status: "new" as SavedContentStatus,
      extraction_status: "extracted" as ExtractionStatus,
      // No stored_path, no content_hash — the video isn't in our bucket.
    })
    .select("id, title, thumbnail_path")
    .single();

  if (rowError || !row) {
    return { success: false, error: rowError?.message ?? "Insert failed" };
  }

  revalidatePath("/content-vault");
  return {
    success: true,
    id: row.id,
    extractionStatus: "extracted",
    downloadProxyUrl: downloadProxyFor(row.id),
    downloadFilename: slugFilename(row.title ?? title, "mp4"),
    thumbnailUrl: publicUrlFor(row.thumbnail_path),
    message: `Extracted — your device is downloading the ${platform} video now.`,
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
    downloadProxyUrl: null,
    downloadFilename: null,
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

function slugFilename(title: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return (slug || "video") + "." + ext;
}

function downloadProxyFor(id: string): string {
  return `/api/vault/download/${id}`;
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
