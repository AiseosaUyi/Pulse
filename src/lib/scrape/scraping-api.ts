// ScraperAPI adapter — handles JS rendering AND anti-bot/TLS fingerprinting
// in one request, for the platforms confirmed during DOM research to need a
// real browser (TixTango, Tickethub.ng — client-rendered Next.js apps with
// no discoverable public API) or blocked at the network layer (Eventpadi —
// TLS fingerprint reset; ScraperAPI presents a real browser TLS stack).
//
// Config: SCRAPERAPI_KEY. Free tier (~5,000 credits/mo, JS rendering costs
// more credits per request than a plain fetch) comfortably covers a
// once-daily crawl across a handful of platforms — this should stay at
// $0/mo at that volume. Gracefully no-ops (returns null) when unset, same
// convention as isSerperConfigured()/isPicsartConfigured() elsewhere in
// this codebase — until a key is provided, these platforms simply produce
// zero candidates rather than erroring the whole run.

const ENDPOINT = "https://api.scraperapi.com/";
const REQUEST_TIMEOUT_MS = 30_000; // rendering takes longer than a plain fetch

export function isScraperApiConfigured(): boolean {
  return !!process.env.SCRAPERAPI_KEY;
}

export interface RenderedFetchResult {
  html: string;
  finalUrl: string;
}

// Returns null (not a throw) when SCRAPERAPI_KEY is unset — callers should
// treat this the same as "platform temporarily produced nothing," not a
// hard failure, since this is an opt-in enhancement, not a dependency.
export async function fetchRenderedHtml(
  url: string
): Promise<RenderedFetchResult | null> {
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) {
    console.warn(
      `[scraping-api] SCRAPERAPI_KEY not set — skipping rendered fetch for ${url}`
    );
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      url,
      render: "true",
    });
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[scraping-api] HTTP ${res.status} rendering ${url}`);
      return null;
    }

    const html = await res.text();
    return { html, finalUrl: url };
  } catch (err) {
    console.error(`[scraping-api] rendered fetch failed for ${url}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
