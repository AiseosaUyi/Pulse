// Unified thumbnail resolver for the content vault. Each platform
// uses a different free mechanism:
//
//   youtube  — deterministic: img.youtube.com/vi/{id}/hqdefault.jpg
//              (zero API calls, works forever for any public video)
//   twitter  — fxtwitter.com's open API: api.fxtwitter.com/status/{id}
//              returns media.all[].thumbnail_url for video tweets
//   instagram — scrape the public /embed page for the cover frame
//              (t51.71878-15 CDN bucket)
//   facebook — not supported today (Graph oembed wants an app token,
//              scraping is blocked). Returns null → emoji placeholder.
//
// Every resolver is non-throwing — failures return null and let the
// orchestrator fall back to the emoji. Missing thumbnails must never
// block extraction.

const REQUEST_TIMEOUT_MS = 10_000;

const IG_COVER_PATTERN = /https:\/\/[a-z0-9.-]+\.cdninstagram\.com\/v\/t51\.71878-15\/[^"\\]+\.(?:jpg|jpeg|webp|png)[^"]*/i;

export async function resolveThumbnail(
  platform: string,
  sourceUrl: string
): Promise<string | null> {
  switch (platform) {
    case "youtube":
      return youtubeThumbnail(sourceUrl);
    case "twitter":
      return twitterThumbnail(sourceUrl);
    case "instagram":
      return instagramThumbnail(sourceUrl);
    case "facebook":
      // No reliable free source. Could add fbsbx/imginn scraping later.
      return null;
    default:
      return null;
  }
}

// ─── YouTube ──────────────────────────────────────────────────

function extractYouTubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (host.endsWith("youtube.com")) {
      // /watch?v=ID | /shorts/ID | /embed/ID
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([A-Za-z0-9_-]+)/);
      if (m) return m[1];
    }
  } catch {
    // fall through
  }
  return null;
}

function youtubeThumbnail(sourceUrl: string): string | null {
  const id = extractYouTubeId(sourceUrl);
  if (!id) return null;
  // hqdefault always exists; maxresdefault 404s on older uploads.
  // fetchBytes will happily fetch hqdefault so we prefer reliability.
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

// ─── Twitter / X ──────────────────────────────────────────────

function extractTweetId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "twitter.com" && host !== "x.com") return null;
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface FxTweetResponse {
  code?: number;
  tweet?: {
    media?: {
      all?: Array<{ thumbnail_url?: string; url?: string; type?: string }>;
      videos?: Array<{ thumbnail_url?: string; url?: string }>;
      photos?: Array<{ url?: string }>;
    };
  };
}

async function twitterThumbnail(sourceUrl: string): Promise<string | null> {
  const id = extractTweetId(sourceUrl);
  if (!id) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Pulse/1.0",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as FxTweetResponse;
    if (body.code !== 200 || !body.tweet?.media) return null;

    const m = body.tweet.media;
    // Prefer video thumbnails, then any media thumbnail, then the
    // first photo URL (for photo-only tweets it IS the "thumbnail").
    const videoThumb = m.videos?.[0]?.thumbnail_url;
    if (videoThumb) return videoThumb;
    const anyThumb = m.all?.find((x) => x.thumbnail_url)?.thumbnail_url;
    if (anyThumb) return anyThumb;
    const firstPhoto = m.photos?.[0]?.url;
    if (firstPhoto) return firstPhoto;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Instagram ────────────────────────────────────────────────

function igEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const match = u.pathname.match(/^\/(p|reel|tv)\/[A-Za-z0-9_-]+/);
    if (!match) return null;
    return `https://www.instagram.com${match[0]}/embed`;
  } catch {
    return null;
  }
}

async function instagramThumbnail(sourceUrl: string): Promise<string | null> {
  const embedUrl = igEmbedUrl(sourceUrl);
  if (!embedUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(IG_COVER_PATTERN);
    if (!match) return null;
    return match[0].replace(/&amp;/g, "&");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
