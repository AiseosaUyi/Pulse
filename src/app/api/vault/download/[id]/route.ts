import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/storage/save-asset";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same-origin streaming proxy. The Supabase Storage public URL is
// cross-origin (project-ref.supabase.co), so browsers ignore the
// <a download> hint and play the MP4 inline. This route streams the
// same bytes through our domain with Content-Disposition: attachment,
// which forces every browser to save-as.
//
// Security: we read the saved_content row through the user's own
// Supabase client so RLS enforces tenancy. Service-role is only used
// for the eventual Storage read (which is fine because the bucket is
// public anyway — we just need a stream handle).

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
      return "bin";
  }
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

  // RLS-scoped read — only returns the row if the caller has tenant
  // membership for it. Never expose other tenants' files.
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("saved_content")
    .select("title, stored_path, stored_mime, source_url")
    .eq("id", id)
    .maybeSingle();

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

  if (!row.stored_path) {
    return NextResponse.json(
      { error: "No stored file for this item" },
      { status: 404 }
    );
  }

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

  const mime = row.stored_mime || blob.type || "application/octet-stream";
  const ext = extFromMime(mime);
  const filename = `${slugify(row.title)}.${ext}`;

  // Stream Blob → Response.
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
