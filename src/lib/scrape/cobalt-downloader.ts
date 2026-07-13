// Cobalt adapter. Talks to a self-hosted cobalt.tools instance via the
// documented POST / endpoint. We only care about two success shapes —
// `tunnel` (cobalt proxies/remuxes the file through itself) and
// `redirect` (cobalt hands us a direct CDN URL). `picker` for carousel
// posts returns the first media item. Everything else is treated as a
// recoverable error so the orchestrator can fall back to link-only.
//
// Configuration: set COBALT_API_URL to the root of your instance
// (e.g. https://pulse-cobalt.onrender.com/). If the env var is absent
// the caller must route the URL to another resolver — isCobaltConfigured()
// lets platform-adapter code branch cleanly.

// 55s ceiling — enough headroom for Render's free-tier cold start
// (~15-30s to spin the container back up) plus cobalt's own resolve
// (~5s warm). Sits just under Vercel's 60s hobby function limit so
// the whole server action still completes in time.
const REQUEST_TIMEOUT_MS = 55_000;

export class CobaltResolveError extends Error {
  constructor(
    message: string,
    public status:
      | "not_configured"
      | "auth_required"
      | "rate_limited"
      | "unsupported"
      | "fetch_failed"
      | "empty"
      | "upstream_error",
    public cause?: unknown
  ) {
    super(message);
    this.name = "CobaltResolveError";
  }
}

export interface ResolvedCobalt {
  /** Final media URL — may be a cobalt tunnel or a direct CDN link. */
  mediaUrl: string;
  /** Cobalt-picked filename (we override with our own slug downstream). */
  filename: string | null;
  /** Shape cobalt returned. `tunnel` means bytes flow through our instance. */
  responseStatus: "tunnel" | "redirect";
  /** Service cobalt detected — useful for metadata + debugging. */
  service: string | null;
  /** True when the source was a multi-item post (carousel) and we took item 0. */
  wasPicker: boolean;
}

export function isCobaltConfigured(): boolean {
  return !!process.env.COBALT_API_URL;
}

/** Hostname of the configured cobalt instance — used by SSRF allowlist. */
export function cobaltHost(): string | null {
  const raw = process.env.COBALT_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

interface CobaltResponse {
  status: "tunnel" | "redirect" | "picker" | "error" | "local-processing";
  url?: string;
  filename?: string;
  service?: string;
  picker?: Array<{ url?: string; type?: string; thumb?: string }>;
  error?: { code?: string; context?: unknown };
}

export async function resolveViaCobalt(url: string): Promise<ResolvedCobalt> {
  const apiUrl = process.env.COBALT_API_URL;
  if (!apiUrl) {
    throw new CobaltResolveError(
      "COBALT_API_URL not set — can't resolve via cobalt",
      "not_configured"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Pulse/1.0",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    // cobalt sends its structured `{status:"error", error:{code}}` body
    // over HTTP 400/etc — NOT 200 — so `!res.ok` alone can't distinguish
    // "cobalt understood the request and rejected this specific URL"
    // (private/deleted post, unsupported link, ...) from "the HTTP layer
    // itself failed" (Render cold-start/gateway error, real outage). Try
    // to parse the body FIRST, on every response regardless of status —
    // a real infra failure (Render's proxy returning HTML/plain-text)
    // won't parse as JSON and falls through to the generic HTTP-status
    // classification below; a well-formed cobalt error body is handled
    // with its actual reason, whatever the HTTP status was.
    let body: CobaltResponse | null = null;
    try {
      body = (await res.json()) as CobaltResponse;
    } catch {
      body = null;
    }

    if (!res.ok && body?.status !== "error") {
      if (res.status === 429) {
        throw new CobaltResolveError(
          "cobalt rate-limited — try again shortly",
          "rate_limited"
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new CobaltResolveError(
          `cobalt requires authentication (HTTP ${res.status})`,
          "auth_required"
        );
      }
      throw new CobaltResolveError(
        `cobalt returned HTTP ${res.status}`,
        "upstream_error"
      );
    }

    if (!body) {
      throw new CobaltResolveError(
        `cobalt returned HTTP ${res.status} with an unparseable body`,
        "upstream_error"
      );
    }

    if (body.status === "error") {
      const code = body.error?.code ?? "unknown";
      if (code.includes("auth")) {
        throw new CobaltResolveError(
          `cobalt auth required: ${code}`,
          "auth_required"
        );
      }
      if (code.includes("unsupported")) {
        throw new CobaltResolveError(
          `cobalt doesn't support this URL: ${code}`,
          "unsupported"
        );
      }
      if (code.includes("empty")) {
        throw new CobaltResolveError(
          `cobalt couldn't find the media (post may be private or deleted): ${code}`,
          "empty"
        );
      }
      if (code.includes("fetch")) {
        throw new CobaltResolveError(
          `cobalt failed to reach the source: ${code}`,
          "fetch_failed"
        );
      }
      throw new CobaltResolveError(`cobalt error: ${code}`, "upstream_error");
    }

    if (body.status === "local-processing") {
      // cobalt wants us to remux multiple streams client-side. Not
      // something we support in a server-side pipeline — treat as
      // unsupported so the orchestrator falls back to link-only.
      throw new CobaltResolveError(
        "cobalt returned local-processing (multi-stream remux not supported server-side)",
        "unsupported"
      );
    }

    if (body.status === "picker") {
      const first = body.picker?.find((p) => !!p.url);
      if (!first?.url) {
        throw new CobaltResolveError(
          "cobalt picker response had no media items",
          "empty"
        );
      }
      return {
        mediaUrl: first.url,
        filename: body.filename ?? null,
        responseStatus: "redirect",
        service: body.service ?? null,
        wasPicker: true,
      };
    }

    if ((body.status === "tunnel" || body.status === "redirect") && body.url) {
      return {
        mediaUrl: body.url,
        filename: body.filename ?? null,
        responseStatus: body.status,
        service: body.service ?? null,
        wasPicker: false,
      };
    }

    throw new CobaltResolveError(
      `cobalt returned unexpected status: ${body.status}`,
      "upstream_error"
    );
  } catch (err) {
    if (err instanceof CobaltResolveError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new CobaltResolveError(
        `cobalt timed out after ${REQUEST_TIMEOUT_MS}ms`,
        "upstream_error",
        err
      );
    }
    throw new CobaltResolveError(
      err instanceof Error ? err.message : String(err),
      "upstream_error",
      err
    );
  } finally {
    clearTimeout(timer);
  }
}
