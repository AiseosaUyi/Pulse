// Asset download + upload pipeline. Used by the vault extractor and
// anything else that needs to pull a remote media URL into our own
// Cloudflare R2 bucket. Guards against SSRF (only known CDN hosts
// allowed), caps file size at 50 MB, and returns a content hash so the
// caller can dedup.

import { createHash } from "node:crypto";
import { uploadToR2, r2PublicUrl, deleteFromR2, isR2Configured } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

export const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB
/** @deprecated bucket name kept for backward compat during migration */
export const STORAGE_BUCKET = "saved-assets";
const FETCH_TIMEOUT_MS = 30_000;

// Host allowlist. The services we call (tikwm, cobalt, later Apify)
// hand back URLs pointing at these CDNs. Anything else is treated as
// hostile. NOTE: private IP ranges are rejected separately in
// `assertSafeUrl`.
const ALLOWED_HOST_PATTERNS: RegExp[] = [
  /\.tiktokcdn(-[a-z]+)?\.com$/i,
  /\.tiktokcdn\.(com|us|eu)$/i,
  /\.cdninstagram\.com$/i,
  /\.fbcdn\.net$/i,
  /(^|\.)scontent(-[a-z0-9-]+)?\.[a-z0-9-]+\.(cdninstagram|fbcdn)\.(com|net)$/i,
  /\.ttwstatic\.com$/i, // TikTok cover fallback
  /\.twimg\.com$/i, // Twitter/X media CDN (videos + tweet photos)
  /^img\.youtube\.com$/i, // YouTube thumbnail CDN
  /\.ytimg\.com$/i, // YouTube alternate thumbnail CDN
];

/**
 * Hosts we trust because *we* deployed them — currently just the
 * configured cobalt instance. Read at call time so tests can stub the
 * env var.
 */
function extraAllowedHosts(): string[] {
  const hosts: string[] = [];
  if (process.env.COBALT_API_URL) {
    try {
      hosts.push(new URL(process.env.COBALT_API_URL).hostname.toLowerCase());
    } catch {
      // Malformed env var — other code will surface the error; don't crash here.
    }
  }
  return hosts;
}

const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe[89ab][0-9a-f]:/i,
];

export class SaveAssetError extends Error {
  constructor(
    message: string,
    public reason:
      | "ssrf_blocked"
      | "too_large"
      | "fetch_failed"
      | "upload_failed",
    public cause?: unknown
  ) {
    super(message);
    this.name = "SaveAssetError";
  }
}

export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SaveAssetError("Invalid URL", "ssrf_blocked");
  }
  if (url.protocol !== "https:") {
    throw new SaveAssetError(
      `Only https URLs allowed (got ${url.protocol})`,
      "ssrf_blocked"
    );
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_IP_PATTERNS.some((r) => r.test(host))) {
    throw new SaveAssetError(
      `Private network hostname rejected: ${host}`,
      "ssrf_blocked"
    );
  }
  if (host === "localhost") {
    throw new SaveAssetError("localhost rejected", "ssrf_blocked");
  }
  const cdnMatch = ALLOWED_HOST_PATTERNS.some((r) => r.test(host));
  const extraMatch = extraAllowedHosts().includes(host);
  if (!cdnMatch && !extraMatch) {
    throw new SaveAssetError(
      `Host not in CDN allowlist: ${host}`,
      "ssrf_blocked"
    );
  }
  return url;
}

export interface FetchedAsset {
  bytes: Buffer;
  mime: string;
  sha256: string;
  extension: string;
}

/** Content-Type → file extension, tightly scoped to what we actually store. */
function extensionFor(mime: string): string {
  const clean = mime.split(";")[0].trim().toLowerCase();
  switch (clean) {
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export async function fetchBytes(rawUrl: string): Promise<FetchedAsset> {
  const url = assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        // Some CDNs 403 without a browser-ish UA.
        "User-Agent":
          "Mozilla/5.0 (compatible; Pulse/1.0; +https://pulse.gruve.events)",
        Accept: "video/*,image/*;q=0.9,*/*;q=0.5",
      },
    });

    if (!res.ok) {
      throw new SaveAssetError(
        `Fetch failed: HTTP ${res.status}`,
        "fetch_failed"
      );
    }

    // Fast reject using Content-Length when server sends it.
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_ASSET_BYTES) {
      throw new SaveAssetError(
        `Asset too large: ${cl} bytes (max ${MAX_ASSET_BYTES})`,
        "too_large"
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new SaveAssetError(
        `Asset too large: ${bytes.length} bytes (max ${MAX_ASSET_BYTES})`,
        "too_large"
      );
    }

    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const extension = extensionFor(mime);

    return { bytes, mime, sha256, extension };
  } catch (err) {
    if (err instanceof SaveAssetError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SaveAssetError(
        `Fetch timed out after ${FETCH_TIMEOUT_MS}ms`,
        "fetch_failed",
        err
      );
    }
    throw new SaveAssetError(
      err instanceof Error ? err.message : String(err),
      "fetch_failed",
      err
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface UploadedAsset {
  storagePath: string;
  publicUrl: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export async function uploadAsset(
  tenantSlug: string,
  asset: FetchedAsset,
  options: { suffix?: string } = {}
): Promise<UploadedAsset> {
  const month = new Date().toISOString().slice(0, 7).replace("-", ""); // yyyymm
  const suffix = options.suffix ? `-${options.suffix}` : "";
  const filename = `${asset.sha256}${suffix}.${asset.extension}`;
  const key = `assets/${tenantSlug}/${month}/${filename}`;

  try {
    await uploadToR2(key, asset.bytes, asset.mime);
  } catch (err) {
    throw new SaveAssetError(
      `R2 upload failed: ${err instanceof Error ? err.message : String(err)}`,
      "upload_failed",
      err
    );
  }

  return {
    storagePath: key,
    publicUrl: r2PublicUrl(key),
    mime: asset.mime,
    sizeBytes: asset.bytes.length,
    sha256: asset.sha256,
  };
}

export async function deleteAsset(storagePath: string): Promise<void> {
  if (isLegacySupabasePath(storagePath)) {
    const admin = createAdminClient();
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return;
  }
  await deleteFromR2(storagePath);
}

export function publicUrlFor(storagePath: string | null): string | null {
  if (!storagePath) return null;
  if (isLegacySupabasePath(storagePath)) {
    // Legacy path written before R2 migration — serve from Supabase Storage.
    const admin = createAdminClient();
    const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  }
  if (!isR2Configured()) return null;
  return r2PublicUrl(storagePath);
}

/** Paths without a prefix segment (e.g. "tenant/yyyymm/hash.ext") are Supabase-era. */
function isLegacySupabasePath(p: string): boolean {
  return (
    !p.startsWith("assets/") &&
    !p.startsWith("videos/") &&
    !p.startsWith("pipeline/") &&
    !p.startsWith("thumbs/")
  );
}
