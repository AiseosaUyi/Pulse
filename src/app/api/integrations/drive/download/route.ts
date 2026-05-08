// Drive download proxy. The browser hits this with ?fileId=<id>;
// we authenticate the user, verify they have a content_items row
// pointing at that file ID in the current tenant, and stream the
// file body back through Pulse with a Content-Disposition header.
//
// Why proxy instead of redirecting to Drive's webContentLink? The
// link requires the user to be logged into Google with the same
// account that owns the file — which is the connection owner, not
// every team member. Proxying lets any tenant member download.

import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DriveError,
} from "@/lib/integrations/drive";
import { getActiveAccessToken } from "@/lib/services/drive-connections";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 400 });
  }

  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  }

  // Verify the file belongs to this tenant — RLS via admin client
  // (we need the row even if RLS denies, to scope correctly)
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("content_items")
    .select("id, drive_mime_type, title")
    .eq("tenant_slug", tenant.slug)
    .eq("drive_file_id", fileId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: "File not in this tenant" },
      { status: 404 }
    );
  }
  const driveMime = (row as { drive_mime_type?: string }).drive_mime_type ?? null;
  const driveTitle = (row as { title?: string }).title ?? null;

  let accessToken: string;
  try {
    const tok = await getActiveAccessToken(tenant.slug);
    accessToken = tok.accessToken;
  } catch (err) {
    if (err instanceof DriveError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Drive auth failed" },
      { status: 500 }
    );
  }

  // supportsAllDrives + acknowledgeAbuse cover edge cases where
  // Drive flags the file (e.g. shared via link from another account).
  // Without these, Drive returns an HTML interstitial page instead
  // of the binary, and the browser opens it as a webpage.
  const driveRes = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (driveRes.status === 401) {
    return NextResponse.json(
      { error: "Drive auth expired" },
      { status: 401 }
    );
  }
  if (driveRes.status === 404) {
    return NextResponse.json({ error: "File not found in Drive" }, { status: 404 });
  }
  if (driveRes.status === 403) {
    return NextResponse.json(
      {
        error:
          "Drive blocked the download. The file may be view-only or the share permissions don't allow downloading.",
      },
      { status: 403 }
    );
  }
  if (!driveRes.ok) {
    return NextResponse.json(
      { error: `Drive returned ${driveRes.status}` },
      { status: 502 }
    );
  }

  // Sanity check: if Drive returned text/html, we got an interstitial
  // (e.g. quota or scan-warning page) instead of the real bytes.
  // Surface a clear error rather than streaming HTML to the user.
  const driveContentType = driveRes.headers.get("content-type") ?? "";
  if (driveContentType.startsWith("text/html")) {
    return NextResponse.json(
      {
        error:
          "Drive returned an HTML page instead of the file. This usually means the file is locked behind a Drive scan or the share permissions don't allow direct download.",
      },
      { status: 502 }
    );
  }

  // Compose a safe filename WITH the right extension. Without an
  // extension, browsers save the file as "<title>" with no type and
  // macOS Finder treats it as a generic document. Map mime → ext
  // so a video/mp4 download lands as "Whatever.mp4" instead of
  // "Whatever".
  const finalMime =
    driveContentType || driveMime || "application/octet-stream";
  const baseTitle = driveTitle
    ? driveTitle.replace(/[^a-zA-Z0-9._-]+/g, "_")
    : `pulse-${fileId}`;
  const ext = mimeToExtension(finalMime);
  const titleHasExt = /\.[a-zA-Z0-9]{2,5}$/.test(baseTitle);
  const safeName = titleHasExt
    ? baseTitle
    : ext
    ? `${baseTitle}.${ext}`
    : baseTitle;

  const headers = new Headers();
  headers.set("Content-Type", finalMime);
  const len = driveRes.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${safeName}"`
  );

  return new Response(driveRes.body, { status: 200, headers });
}

// Minimal mime → extension lookup. Covers the common cases the team
// will actually upload (videos, images, PDF, common docs). Anything
// else falls through and we don't append an extension — better than
// guessing wrong.
const MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "video/mpeg": "mpeg",
  "video/x-msvideo": "avi",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

function mimeToExtension(mime: string): string | null {
  // Strip parameters like "; charset=utf-8"
  const base = mime.split(";")[0].trim().toLowerCase();
  return MIME_EXT[base] ?? null;
}

