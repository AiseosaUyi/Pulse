// Instagram thumbnail resolver. Cobalt doesn't hand back thumbnails for
// IG posts — it only returns the video URL. But Instagram's /embed
// route serves a much simpler HTML page (used by WordPress, Tumblr,
// etc. to embed IG posts) that exposes the post's cover-frame image
// from the public CDN. No auth, no API key, just a GET with a browser
// user-agent.
//
// The cover frame lives under the `t51.71878-15` CDN prefix (IG's
// video-cover bucket, as opposed to `t51.82787-19` which is the
// profile avatar). We grab the first such URL we see and let the
// existing save-asset pipeline fetch/upload it as our thumbnail.
//
// Falls through to null on any failure — the caller uses the emoji
// placeholder as fallback. No exception thrown because missing a
// thumbnail must never block extraction.

const REQUEST_TIMEOUT_MS = 10_000;
const COVER_FRAME_PATTERN = /https:\/\/[a-z0-9.-]+\.cdninstagram\.com\/v\/t51\.71878-15\/[^"\\]+\.(?:jpg|jpeg|webp|png)[^"]*/i;

/**
 * Normalizes an Instagram post/reel URL to its embed form.
 *   https://www.instagram.com/reel/CODE/?utm_source=...
 *     → https://www.instagram.com/reel/CODE/embed
 */
function toEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    // Keep only the /p/CODE/ or /reel/CODE/ or /tv/CODE/ path, drop
    // query string (embed doesn't need it and some params confuse IG).
    const match = u.pathname.match(/^\/(p|reel|tv)\/[A-Za-z0-9_-]+/);
    if (!match) return null;
    return `https://www.instagram.com${match[0]}/embed`;
  } catch {
    return null;
  }
}

/**
 * Fetch the Instagram embed page and extract the cover-frame image URL.
 * Returns null if the URL isn't an IG post/reel, the request fails, or
 * the cover frame isn't in the HTML (private or deleted posts).
 */
export async function resolveInstagramThumbnail(
  sourceUrl: string
): Promise<string | null> {
  const embedUrl = toEmbedUrl(sourceUrl);
  if (!embedUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(embedUrl, {
      headers: {
        // IG serves a bot-wall to plain fetch; a browsery UA gets the
        // real embed HTML.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;

    const html = await res.text();
    const match = html.match(COVER_FRAME_PATTERN);
    if (!match) return null;

    // IG's HTML encodes `&` as `&amp;` — un-encode so fetch doesn't
    // treat the literal entity as part of the query string.
    return match[0].replace(/&amp;/g, "&");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
