// Server-side proxy for resumable Drive upload chunks. Direct
// browser→Drive PUTs hit CORS rejection in some browser/network
// configurations. This proxy moves that single hop server-side
// where CORS doesn't apply.
//
// Browser PUTs a 4MB chunk to this endpoint with the upload
// session ID and Content-Range header. Server validates the
// session belongs to the user, forwards the chunk to Drive's
// resumable URI with the same Content-Range, and returns Drive's
// response (status + body + Range header) back to the browser.
//
// Chunk size is set in src/lib/upload/resumable-put.ts to 4MB so
// each request stays under Vercel's 4.5MB default function body
// limit (8MB chunks 413'd in production). For very large files
// (>1GB) the browser uploads many chunks in sequence — bandwidth
// flows through Pulse but in bounded pieces.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function PUT(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const contentRange = req.headers.get("content-range");
  if (!contentRange) {
    return NextResponse.json(
      { error: "Missing Content-Range" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("content_upload_sessions")
    .select("id, user_id, drive_resumable_uri, status")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json(
      { error: "Upload session not found" },
      { status: 404 }
    );
  }
  if (session.status !== "pending") {
    return NextResponse.json(
      { error: `Session is ${session.status}` },
      { status: 410 }
    );
  }

  // Read the chunk body. Drive needs the raw bytes with the same
  // Content-Range we received. We forward Content-Type if the client
  // set one (browsers sometimes send video/mp4 etc.).
  const body = await req.arrayBuffer();
  const driveHeaders: Record<string, string> = {
    "Content-Range": contentRange,
  };
  const incomingType = req.headers.get("content-type");
  if (incomingType) {
    driveHeaders["Content-Type"] = incomingType;
  }

  const driveRes = await fetch(session.drive_resumable_uri, {
    method: "PUT",
    headers: driveHeaders,
    body,
  });

  // Drive returns:
  //   308 Resume Incomplete + Range header + empty body — partial
  //   200/201 OK + JSON body with file info — complete
  //   4xx — error
  if (driveRes.status === 308) {
    const range = driveRes.headers.get("range");
    return NextResponse.json(
      { status: "partial", range },
      { status: 308, headers: range ? { range } : undefined }
    );
  }
  if (driveRes.status === 200 || driveRes.status === 201) {
    const driveBody = await driveRes.json().catch(() => null);
    return NextResponse.json(
      { status: "complete", body: driveBody },
      { status: 200 }
    );
  }

  // Forward the error
  const errorText = await driveRes.text().catch(() => "");
  return NextResponse.json(
    {
      status: "error",
      driveStatus: driveRes.status,
      body: errorText,
    },
    { status: driveRes.status === 404 ? 410 : 502 }
  );
}
