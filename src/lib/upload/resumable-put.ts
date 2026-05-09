// Browser-side resumable upload to a Drive session URI. Chunks the
// file into 4MB blocks (Drive requires multiples of 256KB). Reports
// progress, supports cancellation. All work happens in the browser —
// the Pulse server is not in the data path.
//
// Recovery: if the page reloads mid-upload, the session URI is in
// localStorage; resume() queries Drive for the current byte offset
// and continues.

// 4 MB keeps each chunk under Vercel's default 4.5 MB function request
// body limit (we proxy chunks via /api/integrations/drive/upload-chunk
// to dodge browser CORS on the direct-to-Drive PUT). 4 MiB is a clean
// multiple of 256 KB, which Drive's resumable upload requires.
const CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB
const STORAGE_KEY_PREFIX = "pulse:upload-session:";

interface ResumableInit {
  /** Drive resumable session URI (kept on ItemDraft for resume from
   * localStorage). Not used directly by the chunk loop anymore —
   * the proxy looks it up server-side via sessionId. */
  uri: string;
  file: File;
  sessionId: string;
  /** Skip the initial status query — true for brand-new sessions
   * where there's nothing to resume. Default false (resume mode). */
  fresh?: boolean;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

const PROXY_ENDPOINT = "/api/integrations/drive/upload-chunk";

export interface ResumableResult {
  driveFileId: string;
  driveMimeType: string;
  driveSizeBytes: number;
  driveWebViewLink?: string;
  thumbnailLink?: string;
}

export class ResumableUploadError extends Error {
  constructor(
    message: string,
    public reason: "auth" | "quota" | "network" | "aborted" | "unexpected",
    public status?: number
  ) {
    super(message);
    this.name = "ResumableUploadError";
  }
}

/**
 * Persists session metadata to localStorage so a reload can resume.
 * Key format includes sessionId so multiple concurrent uploads don't
 * collide.
 */
function persistSession(sessionId: string, uri: string, filename: string) {
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + sessionId,
      JSON.stringify({ uri, filename, createdAt: Date.now() })
    );
  } catch {
    // Quota exceeded or private mode — no-op; uploads still work for
    // the active tab.
  }
}

function clearSession(sessionId: string) {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + sessionId);
  } catch {
    // ignore
  }
}

export function listPersistedSessions(): Array<{
  sessionId: string;
  uri: string;
  filename: string;
  createdAt: number;
}> {
  const out: Array<{
    sessionId: string;
    uri: string;
    filename: string;
    createdAt: number;
  }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(STORAGE_KEY_PREFIX)) continue;
      const v = localStorage.getItem(k);
      if (!v) continue;
      try {
        const parsed = JSON.parse(v) as {
          uri: string;
          filename: string;
          createdAt: number;
        };
        out.push({
          sessionId: k.slice(STORAGE_KEY_PREFIX.length),
          uri: parsed.uri,
          filename: parsed.filename,
          createdAt: parsed.createdAt,
        });
      } catch {
        // skip corrupt entries
      }
    }
  } catch {
    // ignore
  }
  return out;
}

// Query Drive for the current byte offset of a partial upload. Sends
// a zero-byte PUT with the Content-Range header set to "bytes (asterisk)/<total>".
// If Drive returns 308 with a Range header, parse the upper bound. If
// it returns 200/201, the upload already completed.
async function queryUploadStatus(
  uri: string,
  totalBytes: number
): Promise<{ status: "complete"; body: unknown } | { status: "partial"; nextByte: number }> {
  const res = await fetch(uri, {
    method: "PUT",
    headers: {
      "Content-Range": `bytes */${totalBytes}`,
    },
  });
  if (res.status === 200 || res.status === 201) {
    return { status: "complete", body: await res.json() };
  }
  if (res.status === 308) {
    const range = res.headers.get("range");
    if (!range) return { status: "partial", nextByte: 0 };
    // Range: bytes=0-<lastByteUploaded>
    const match = /bytes=\d+-(\d+)/.exec(range);
    return {
      status: "partial",
      nextByte: match ? parseInt(match[1], 10) + 1 : 0,
    };
  }
  if (res.status === 404 || res.status === 410) {
    throw new ResumableUploadError(
      "Upload session expired",
      "unexpected",
      res.status
    );
  }
  throw new ResumableUploadError(
    `Unexpected status ${res.status} when querying upload`,
    "network",
    res.status
  );
}

/**
 * Run a resumable upload to completion via the Pulse server proxy.
 * Each 4MB chunk goes browser → /api/integrations/drive/upload-chunk
 * → Drive's resumable session URI. The proxy hop sidesteps browser
 * CORS rejections that block direct browser→Drive PUTs in some
 * networks.
 */
export async function runResumableUpload(
  init: ResumableInit
): Promise<ResumableResult> {
  const { uri, file, sessionId, onProgress, signal } = init;
  persistSession(sessionId, uri, file.name);

  let nextByte = 0;
  while (nextByte < file.size) {
    if (signal?.aborted) {
      throw new ResumableUploadError("Upload aborted", "aborted");
    }
    const end = Math.min(nextByte + CHUNK_BYTES, file.size);
    const chunk = file.slice(nextByte, end);
    const isLast = end === file.size;
    const range = `bytes ${nextByte}-${end - 1}/${file.size}`;

    const res = await fetch(
      `${PROXY_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Range": range,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: chunk,
        signal,
      }
    );

    // Proxy returns:
    //   308 + body { range } — partial; advance nextByte
    //   200 + body { status:"complete", body: <drive json> } — done
    //   410 — session expired/abandoned
    //   401/403 — Drive auth issue
    if (res.status === 308) {
      const data = (await res.json().catch(() => null)) as {
        range?: string;
      } | null;
      const rangeHeader =
        data?.range ?? res.headers.get("range") ?? "";
      const match = /bytes=\d+-(\d+)/.exec(rangeHeader);
      nextByte = match ? parseInt(match[1], 10) + 1 : end;
      onProgress?.(nextByte, file.size);
      continue;
    }
    if (res.status === 200 && isLast) {
      const data = (await res.json()) as {
        status: string;
        body: unknown;
      };
      if (data.status === "complete") {
        clearSession(sessionId);
        onProgress?.(file.size, file.size);
        return parseDriveResponse(data.body, file);
      }
    }
    if (res.status === 401) {
      throw new ResumableUploadError(
        "Drive auth expired during upload",
        "auth",
        401
      );
    }
    if (res.status === 403) {
      throw new ResumableUploadError(
        "Drive quota or permission denied",
        "quota",
        403
      );
    }
    if (res.status === 410 || res.status === 404) {
      clearSession(sessionId);
      throw new ResumableUploadError(
        "Upload session expired",
        "unexpected",
        res.status
      );
    }
    throw new ResumableUploadError(
      `Upload proxy returned ${res.status}`,
      "network",
      res.status
    );
  }

  throw new ResumableUploadError(
    "Upload finished but server did not confirm completion",
    "unexpected"
  );
}

function parseDriveResponse(body: unknown, file: File): ResumableResult {
  const obj = body as {
    id?: string;
    mimeType?: string;
    size?: string;
    webViewLink?: string;
    thumbnailLink?: string;
  };
  if (!obj || !obj.id) {
    throw new ResumableUploadError(
      "Drive response missing file ID",
      "unexpected"
    );
  }
  return {
    driveFileId: obj.id,
    driveMimeType: obj.mimeType ?? file.type ?? "application/octet-stream",
    driveSizeBytes: obj.size ? parseInt(obj.size, 10) : file.size,
    driveWebViewLink: obj.webViewLink,
    thumbnailLink: obj.thumbnailLink,
  };
}

// Build a small data-URL preview entirely in the browser. Used by
// the metadata stepper (so users can tell their files apart) and
// also persisted to Supabase Storage as the row's permanent
// thumbnail — no dependency on Drive's eventually-consistent
// thumbnailLink.
//
// Images: scaled with canvas.
// Videos: a frame is captured ~1 second in (or earlier if the clip
//   is shorter) using a hidden <video> element. Browsers refuse to
//   draw frames from cross-origin videos, but here the source is a
//   blob URL of the user's local file, so this is fine.
export async function generateLocalPreview(
  file: File,
  maxDim = 320
): Promise<string | null> {
  if (file.type.startsWith("image/")) {
    return generateImagePreview(file, maxDim);
  }
  if (file.type.startsWith("video/")) {
    return generateVideoPreview(file, maxDim);
  }
  return null;
}

function generateImagePreview(
  file: File,
  maxDim: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function generateVideoPreview(
  file: File,
  maxDim: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (out: string | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(out);
    };
    // Hard cap so a busted file can't hang the modal forever.
    const timer = window.setTimeout(() => finish(null), 8000);

    video.preload = "metadata";
    video.muted = true;
    // Required on iOS so the element will load metadata without a
    // user gesture
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.addEventListener("loadeddata", () => {
      // Seek to ~1s in — usually past intro fades. If the clip is
      // shorter, take a frame at 25% of duration.
      const target =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(1, video.duration * 0.25)
          : 0;
      try {
        video.currentTime = target;
      } catch {
        finish(null);
      }
    });

    video.addEventListener("seeked", () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
          finish(null);
          return;
        }
        const ratio = Math.min(maxDim / w, maxDim / h, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        window.clearTimeout(timer);
        finish(dataUrl);
      } catch {
        finish(null);
      }
    });

    video.addEventListener("error", () => finish(null));
    video.src = url;
  });
}
