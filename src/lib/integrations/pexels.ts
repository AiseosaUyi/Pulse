// Pexels stock-image search. Free tier, no attribution required, hotlink-OK.
// Platform-level key (PEXELS_API_KEY) — Pexels is a shared image source across
// all tenants, not tenant-specific. Graceful degrade when unset (like Serper).

const PEXELS_KEY = process.env.PEXELS_API_KEY;

export function isPexelsConfigured(): boolean {
  return Boolean(PEXELS_KEY);
}

export interface PexelsImage {
  url: string; // high-res original
  photographer: string;
  alt: string;
  pexelsUrl: string; // the photo's page (courtesy link)
}

interface PexelsPhoto {
  src?: { original?: string; large2x?: string; large?: string };
  alt?: string;
  photographer?: string;
  url?: string;
}

/**
 * Search Pexels for the best landscape photo matching `query`. Returns null
 * when not configured, on error, or no results — callers degrade gracefully.
 */
export async function searchPexelsImage(
  query: string,
  opts: { orientation?: "landscape" | "portrait" | "square" } = {}
): Promise<PexelsImage | null> {
  if (!PEXELS_KEY || !query.trim()) return null;
  try {
    const params = new URLSearchParams({
      query: query.trim(),
      per_page: "5",
      orientation: opts.orientation ?? "landscape",
    });
    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: PEXELS_KEY },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      photos?: PexelsPhoto[];
    } | null;
    const photo = body?.photos?.[0];
    const url = photo?.src?.original ?? photo?.src?.large2x ?? photo?.src?.large;
    if (!photo || !url) return null;
    return {
      url,
      photographer: photo.photographer ?? "Pexels",
      alt: photo.alt ?? query.trim(),
      pexelsUrl: photo.url ?? "https://www.pexels.com",
    };
  } catch {
    return null;
  }
}
