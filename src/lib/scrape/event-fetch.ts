// Shared HTTP fetch for the self-hosted event-platform scraper. Deliberately
// NOT Apify — these are ticketing sites, not Instagram, so no hosted crawler
// is needed (see design doc: "these event tools dont have that much
// security to need apify"). No proxy is provisioned by default — cost
// constraint is zero net-new spend until a platform is actually observed
// blocking requests (see EVENT_SCRAPER_BLOCK_THRESHOLD in event-scraper-runner.ts).

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export class EventFetchError extends Error {
  constructor(
    message: string,
    public status: "timeout" | "http_error" | "network_error",
    public httpStatus?: number
  ) {
    super(message);
    this.name = "EventFetchError";
  }
}

export interface FetchEventHtmlResult {
  html: string;
  finalUrl: string;
  httpStatus: number;
}

// Fetches a page as a real browser would (UA + Accept headers, follows
// redirects). No JS execution — platforms that need client-side rendering
// to expose event data are out of scope for this fetcher (see per-platform
// config `requiresBrowser` flag) and should not be routed through this path.
export async function fetchEventHtml(
  url: string,
  opts?: { timeoutMs?: number }
): Promise<FetchEventHtmlResult> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new EventFetchError(
        `HTTP ${res.status} fetching ${url}`,
        "http_error",
        res.status
      );
    }

    const html = await res.text();
    return { html, finalUrl: res.url || url, httpStatus: res.status };
  } catch (err) {
    if (err instanceof EventFetchError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new EventFetchError(`Timed out fetching ${url}`, "timeout");
    }
    throw new EventFetchError(
      err instanceof Error ? err.message : String(err),
      "network_error"
    );
  } finally {
    clearTimeout(timer);
  }
}
