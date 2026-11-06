// yt-dlp microservice adapter. Talks to the parallel-built ytdlp resolver
// service (services/ytdlp-resolver/) which is currently under construction.
//
// The free Render instance cold-starts: allow up to 55s timeout for /resolve
// and 60s for /download via AbortController so the whole server action still
// completes before Vercel's 60s hobby function limit.
//
// This module is Instagram-specific: cobalt returns JPG covers for IG reels,
// but yt-dlp can extract the real video bytes.

const REQUEST_TIMEOUT_RESOLVE_MS = 55_000;
const REQUEST_TIMEOUT_DOWNLOAD_MS = 60_000;

export class YtdlpResolveError extends Error {
  constructor(
    message: string,
    public status:
      | "not_configured"
      | "no_video"
      | "busy"
      | "auth_required"
      | "upstream_error"
      | "timeout",
    public cause?: unknown
  ) {
    super(message);
    this.name = "YtdlpResolveError";
  }
}

/** True when both YTDLP_API_URL and YTDLP_API_KEY are set in env. */
export function isYtdlpConfigured(): boolean {
  return (
    typeof process.env.YTDLP_API_URL === "string" &&
    process.env.YTDLP_API_URL.length > 0 &&
    typeof process.env.YTDLP_API_KEY === "string" &&
    process.env.YTDLP_API_KEY.length > 0
  );
}

/** Resolve an Instagram URL via the yt-dlp microservice — /resolve endpoint.
 *  Returns video metadata (title, duration, uploader, thumbnail). */
export async function resolveInstagramViaYtdlp(url: string): Promise<{
  title: string;
  durationSec: number | null;
  uploader: string | null;
  thumbnail: string | null;
}> {
  const baseUrl = process.env.YTDLP_API_URL;
  if (!baseUrl) {
    throw new YtdlpResolveError(
      "ytdlp microservice URL not configured — can't resolve Instagram",
      "not_configured"
    );
  }

  const apiKey = process.env.YTDLP_API_KEY;
  if (!apiKey) {
    throw new YtdlpResolveError(
      "ytdlp API key not configured — can't authenticate",
      "not_configured"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_RESOLVE_MS);

  try {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    // Always try to parse the body first — cobalt-style structured errors
    // may arrive over any HTTP status code.
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      const json = (body as Record<string, unknown>) ?? {};
      if (res.status === 429 || (json.error && String(json.error).includes("busy"))) {
        throw new YtdlpResolveError(
          "ytdlp service is busy — try again in a moment",
          "busy"
        );
      }
      if (res.status === 401) {
        throw new YtdlpResolveError(
          "ytdlp requires authentication — check API key config",
          "auth_required"
        );
      }
      if (res.status === 422) {
        throw new YtdlpResolveError(
          "no video found in this post — the content may be image-only or private",
          "no_video"
        );
      }
      if ((json as Record<string, unknown>).ok === false) {
        const msg = String((json.error ?? (json as Record<string, unknown>)?.error ?? "extraction failed"));
        throw new YtdlpResolveError(msg, "upstream_error");
      }
      // Fallback for unexpected non-200 responses.
      throw new YtdlpResolveError(
        `ytdlp returned HTTP ${res.status}`,
        "upstream_error"
      );
    }

    const okBody = body as {
      ok: true;
      kind?: string;
      title?: string;
      duration?: number | null;
      uploader?: string | null;
      thumbnail?: string | null;
    };
    if (!okBody.ok || okBody.kind !== "video") {
      throw new YtdlpResolveError(
        "ytdlp returned an unexpected response shape — expected kind:video",
        "upstream_error"
      );
    }

    return {
      title: (okBody.title as string) ?? "",
      durationSec: okBody.duration ?? null,
      uploader: okBody.uploader ?? null,
      thumbnail: okBody.thumbnail ?? null,
    };
  } catch (err) {
    if (err instanceof YtdlpResolveError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new YtdlpResolveError(
        `ytdlp timed out after ${REQUEST_TIMEOUT_RESOLVE_MS}ms — the service may be cold-starting`,
        "timeout"
      );
    }
    throw new YtdlpResolveError(
      err instanceof Error ? err.message : String(err),
      "upstream_error",
      err
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Open an Instagram download stream via the yt-dlp microservice — /download endpoint.
 *  Returns the fetch Response directly so the caller can stream it to the client.
 *  Throws YtdlpResolveError on non-200 responses. Never logs the API key. */
export async function openInstagramDownload(url: string): Promise<Response> {
  const baseUrl = process.env.YTDLP_API_URL;
  if (!baseUrl) {
    throw new YtdlpResolveError(
      "ytdlp microservice URL not configured — can't download Instagram",
      "not_configured"
    );
  }

  const apiKey = process.env.YTDLP_API_KEY;
  if (!apiKey) {
    throw new YtdlpResolveError(
      "ytdlp API key not configured — can't authenticate",
      "not_configured"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_DOWNLOAD_MS);

  try {
    const res = await fetch(`${baseUrl}/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Only read the body on errors — on success the body IS the video
      // stream and must stay unread for the caller to pipe through.
      let json: Record<string, unknown> = {};
      try {
        json = ((await res.json()) as Record<string, unknown>) ?? {};
      } catch {
        json = {};
      }
      if (res.status === 429 || (json.error && String(json.error).includes("busy"))) {
        throw new YtdlpResolveError(
          "ytdlp service is busy — try again in a moment",
          "busy"
        );
      }
      if (res.status === 401) {
        throw new YtdlpResolveError(
          "ytdlp requires authentication — check API key config",
          "auth_required"
        );
      }
      if (res.status === 422) {
        throw new YtdlpResolveError(
          "no video found in this post — the content may be image-only or private",
          "no_video"
        );
      }
      if (json.ok === false) {
        throw new YtdlpResolveError(
          String(json.error ?? "extraction failed"),
          "upstream_error"
        );
      }
      throw new YtdlpResolveError(
        `ytdlp returned HTTP ${res.status}`,
        "upstream_error"
      );
    }

    return res;
  } catch (err) {
    if (err instanceof YtdlpResolveError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new YtdlpResolveError(
        `ytdlp timed out after ${REQUEST_TIMEOUT_DOWNLOAD_MS}ms — the service may be cold-starting`,
        "timeout"
      );
    }
    throw new YtdlpResolveError(
      err instanceof Error ? err.message : String(err),
      "upstream_error",
      err
    );
  } finally {
    clearTimeout(timer);
  }
}
