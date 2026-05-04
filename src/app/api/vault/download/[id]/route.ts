import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  STORAGE_BUCKET,
  fetchBytes,
  SaveAssetError,
} from "@/lib/storage/save-asset";
import {
  resolveTikTok,
  TikTokResolveError,
} from "@/lib/scrape/tiktok-downloader";
import {
  resolveViaCobalt,
  CobaltResolveError,
} from "@/lib/scrape/cobalt-downloader";

export const dynamic = "force-dynamic";
// Cold cobalt + re-resolve + fetch 50 MB needs ~30-45s worst case.
export const maxDuration = 60;

// Same-origin streaming proxy. Two code paths:
//
//   A. Legacy — row.stored_path present: stream the bucket file.
//      Used for rows saved before we flipped to lean storage.
//
//   B. Current — no stored file: re-resolve the source URL now via
//      tikwm (TikTok) or cobalt (IG/YT/X/FB), fetch fresh CDN bytes,
//      stream them back. This is how most downloads work now.
//
// Both paths ship Content-Disposition: attachment so the browser
// always saves the file (never inline-play).

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "video"
  );
}

function extFromMime(mime: string | null | undefined): string {
  switch ((mime ?? "").split(";")[0].trim().toLowerCase()) {
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
      return "mp4";
  }
}

interface VaultRow {
  title: string;
  stored_path: string | null;
  stored_mime: string | null;
  source_url: string | null;
  source_platform: string | null;
  extraction_status: string;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("saved_content")
    .select(
      "title, stored_path, stored_mime, source_url, source_platform, extraction_status"
    )
    .eq("id", id)
    .maybeSingle<VaultRow>();

  if (error || !row) {
    if (error) {
      console.error("[vault/download] row lookup failed", {
        id,
        userId: user.id,
        message: error.message,
      });
    }
    return NextResponse.json(
      { error: "Not found or access denied" },
      { status: 404 }
    );
  }

  // Path A: legacy stored file.
  if (row.stored_path) {
    const admin = createAdminClient();
    const { data: blob, error: dlError } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(row.stored_path);

    if (dlError || !blob) {
      console.error("[vault/download] storage read failed", {
        id,
        userId: user.id,
        path: row.stored_path,
        message: dlError?.message ?? "no data",
      });
      return NextResponse.json(
        { error: `Storage read failed: ${dlError?.message ?? "no data"}` },
        { status: 502 }
      );
    }

    const mime = row.stored_mime || blob.type || "video/mp4";
    const ext = extFromMime(mime);
    const filename = `${slugify(row.title)}.${ext}`;

    return new Response(blob.stream(), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(blob.size),
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Path B: re-resolve on demand.
  if (
    row.extraction_status !== "extracted" ||
    !row.source_url ||
    !row.source_platform
  ) {
    return NextResponse.json(
      { error: "No downloadable media (this item was saved as a link only)" },
      { status: 404 }
    );
  }

  let freshMediaUrl: string;
  try {
    if (row.source_platform === "tiktok") {
      const r = await resolveTikTok(row.source_url);
      freshMediaUrl = r.videoUrl;
    } else {
      const r = await resolveViaCobalt(row.source_url);
      freshMediaUrl = r.mediaUrl;
    }
  } catch (err) {
    const reason =
      err instanceof TikTokResolveError || err instanceof CobaltResolveError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[vault/download] re-resolve failed", {
      id,
      userId: user.id,
      platform: row.source_platform,
      message: reason,
    });
    const isTimeout = reason.includes("timed out");
    const userMessage = isTimeout
      ? `Download service is slow right now (${row.source_platform}). Try again in a few seconds — the resolver was warming up.`
      : `Couldn't refresh the download link (${row.source_platform}): ${reason}. The original post may have been deleted or made private.`;
    return NextResponse.json(
      { error: userMessage },
      { status: 502 }
    );
  }

  let asset;
  try {
    asset = await fetchBytes(freshMediaUrl);
  } catch (err) {
    const reason =
      err instanceof SaveAssetError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[vault/download] fetch failed", {
      id,
      userId: user.id,
      platform: row.source_platform,
      url: freshMediaUrl.slice(0, 120),
      message: reason,
    });
    return NextResponse.json(
      { error: `Download failed: ${reason}` },
      { status: 502 }
    );
  }

  const mime = asset.mime || "video/mp4";
  const ext = extFromMime(mime);
  const filename = `${slugify(row.title)}.${ext}`;

  // Node 22+ types Buffer as Buffer<ArrayBufferLike>, which BlobPart
  // doesn't accept. Uint8Array.from produces a clean Uint8Array<ArrayBuffer>
  // that both Blob and Response are happy with. Memcpy cost at 50 MB
  // is ~10 ms, negligible next to the network latency.
  const body = new Blob([Uint8Array.from(asset.bytes)], { type: mime });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(asset.bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
