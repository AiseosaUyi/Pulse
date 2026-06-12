// AI-search visibility checker (GEO/AEO). Asks an AI answer engine a query
// and reports whether a domain is among the cited sources. Real citations
// only — when no engine is configured it returns { checked: false } and the
// caller writes nothing (never fabricates a citation).
//
// Perplexity is the first engine: its chat completions API returns a
// `citations` array of source URLs for the answer. Google AI Overviews has
// no official API; left as a future engine (the table supports it).

export type AiEngine = "perplexity" | "google_aio";

export interface AiVisibilityResult {
  checked: boolean;
  engine: AiEngine;
  cited: boolean;
  position: number | null; // index in the citation list (1-based)
  sourceUrl: string | null;
  error?: string;
}

export function isPerplexityConfigured(): boolean {
  return Boolean(process.env.PERPLEXITY_API_KEY);
}

interface PerplexityResponse {
  citations?: string[];
  // Newer responses nest sources under search_results[].url
  search_results?: Array<{ url?: string }>;
  error?: { message?: string } | string;
}

/**
 * Ask Perplexity the query and check whether `domain` appears in the answer's
 * citations. `domain` should be the bare host (e.g. "gruve.events").
 */
export async function checkPerplexityVisibility(
  query: string,
  domain: string
): Promise<AiVisibilityResult> {
  const base: AiVisibilityResult = {
    checked: false,
    engine: "perplexity",
    cited: false,
    position: null,
    sourceUrl: null,
  };

  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return base;

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
    });

    const body = (await res.json().catch(() => ({}))) as PerplexityResponse;
    if (!res.ok) {
      const msg =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? `Perplexity API ${res.status}`;
      return { ...base, checked: true, error: msg };
    }

    const citations =
      body.citations ??
      (body.search_results ?? [])
        .map((s) => s.url)
        .filter((u): u is string => Boolean(u));

    let position: number | null = null;
    let sourceUrl: string | null = null;
    citations.forEach((url, i) => {
      if (position !== null) return;
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        if (host === domain || host.endsWith(`.${domain}`)) {
          position = i + 1;
          sourceUrl = url;
        }
      } catch {
        /* ignore malformed citation URL */
      }
    });

    return {
      checked: true,
      engine: "perplexity",
      cited: position !== null,
      position,
      sourceUrl,
    };
  } catch (err) {
    return {
      ...base,
      checked: true,
      error: err instanceof Error ? err.message : "Perplexity request failed",
    };
  }
}
