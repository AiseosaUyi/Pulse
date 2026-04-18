// TikTok content resolver. Uses tikwm.com's free POST API to turn a
// tiktok.com/@user/video/{id} URL into a no-watermark HD MP4 URL plus
// metadata. Free service, no key, public infra — we don't retry
// aggressively to stay polite.

const TIKWM_ENDPOINT = "https://www.tikwm.com/api/";
const REQUEST_TIMEOUT_MS = 15_000;

export interface ResolvedTikTok {
  videoUrl: string;
  /** Higher-quality no-watermark variant when available. */
  hdVideoUrl: string | null;
  thumbnailUrl: string | null;
  audioUrl: string | null;
  title: string | null;
  authorHandle: string | null;
  authorName: string | null;
  durationSec: number | null;
  hashtags: string[];
}

export class TikTokResolveError extends Error {
  constructor(
    message: string,
    public status: "rate_limited" | "upstream_error" | "invalid_url" | "empty",
    public cause?: unknown
  ) {
    super(message);
    this.name = "TikTokResolveError";
  }
}

export async function resolveTikTok(url: string): Promise<ResolvedTikTok> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({ url, hd: "1" });
    const res = await fetch(TIKWM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Pulse/1.0",
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        throw new TikTokResolveError(
          "tikwm rate-limited — try again in a few minutes",
          "rate_limited"
        );
      }
      throw new TikTokResolveError(
        `tikwm returned HTTP ${res.status}`,
        "upstream_error"
      );
    }

    const json = (await res.json()) as {
      code: number;
      msg?: string;
      data?: {
        play?: string;
        hdplay?: string;
        cover?: string;
        origin_cover?: string;
        music?: string;
        title?: string;
        duration?: number;
        author?: { unique_id?: string; nickname?: string };
      };
    };

    if (json.code !== 0) {
      const msg = json.msg ?? "unknown error";
      if (/url.*(parsing|invalid)/i.test(msg)) {
        throw new TikTokResolveError(msg, "invalid_url");
      }
      throw new TikTokResolveError(`tikwm: ${msg}`, "upstream_error");
    }

    const d = json.data;
    if (!d?.play && !d?.hdplay) {
      throw new TikTokResolveError(
        "tikwm returned no video URL",
        "empty"
      );
    }

    const title = d.title?.trim() || null;
    const hashtags: string[] = title
      ? Array.from(title.matchAll(/#([\p{L}\p{N}_]+)/gu), (m) => m[1])
      : [];

    return {
      videoUrl: d.hdplay || d.play || "",
      hdVideoUrl: d.hdplay || null,
      thumbnailUrl: d.cover || d.origin_cover || null,
      audioUrl: d.music || null,
      title,
      authorHandle: d.author?.unique_id ?? null,
      authorName: d.author?.nickname ?? null,
      durationSec: d.duration ?? null,
      hashtags,
    };
  } catch (err) {
    if (err instanceof TikTokResolveError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new TikTokResolveError(
        `tikwm timed out after ${REQUEST_TIMEOUT_MS}ms`,
        "upstream_error",
        err
      );
    }
    throw new TikTokResolveError(
      err instanceof Error ? err.message : String(err),
      "upstream_error",
      err
    );
  } finally {
    clearTimeout(timer);
  }
}
