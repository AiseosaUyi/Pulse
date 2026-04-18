// Serper.dev adapter — free Google SERP (2,500 searches/month on the
// free tier, way more than we need for current tenant count). Returns
// the same SerpResult[] shape as the Apify path so the orchestrator
// can treat them interchangeably.
//
// Config: SERPER_API_KEY. Endpoint: POST https://google.serper.dev/search
// Auth: X-API-KEY header.

import type { SerpResult } from "@/lib/scrape/google-serp";

const ENDPOINT = "https://google.serper.dev/search";
const REQUEST_TIMEOUT_MS = 15_000;

export class SerperError extends Error {
  constructor(
    message: string,
    public status:
      | "not_configured"
      | "auth_failed"
      | "rate_limited"
      | "quota_exhausted"
      | "empty"
      | "upstream_error",
    public httpStatus?: number,
    public cause?: unknown
  ) {
    super(message);
    this.name = "SerperError";
  }
}

export function isSerperConfigured(): boolean {
  return !!process.env.SERPER_API_KEY;
}

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  sitelinks?: Array<{ title?: string; link?: string }>;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
  answerBox?: unknown;
  peopleAlsoAsk?: unknown[];
  knowledgeGraph?: unknown;
  relatedSearches?: unknown[];
  message?: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function serpFeaturesFromResponse(r: SerperResponse): string[] {
  const features: string[] = [];
  if (r.answerBox) features.push("featured_snippet");
  if (r.peopleAlsoAsk && r.peopleAlsoAsk.length > 0) features.push("people_also_ask");
  if (r.knowledgeGraph) features.push("knowledge_panel");
  if (r.relatedSearches && r.relatedSearches.length > 0) features.push("related_searches");
  return features;
}

interface SerperInput {
  query: string;
  region?: string;
  limit?: number;
}

export async function scrapeViaSerper(
  input: SerperInput
): Promise<SerpResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new SerperError(
      "SERPER_API_KEY not set — skipping Serper and falling back",
      "not_configured"
    );
  }

  const limit = input.limit ?? 10;
  const body = {
    q: input.query,
    gl: (input.region ?? "ng").toLowerCase(),
    hl: "en",
    num: limit,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new SerperError(
        `Serper rejected the API key (HTTP ${res.status})`,
        "auth_failed",
        res.status
      );
    }
    if (res.status === 429) {
      throw new SerperError(
        "Serper rate limit or monthly quota exhausted",
        "rate_limited",
        res.status
      );
    }
    if (res.status === 402) {
      // Serper returns 402 Payment Required when the free plan's
      // monthly budget is exceeded.
      throw new SerperError(
        "Serper monthly quota exhausted (upgrade or wait)",
        "quota_exhausted",
        res.status
      );
    }
    if (!res.ok) {
      throw new SerperError(
        `Serper returned HTTP ${res.status}`,
        "upstream_error",
        res.status
      );
    }

    const data = (await res.json()) as SerperResponse;
    const organic = data.organic ?? [];

    if (organic.length === 0) {
      throw new SerperError("Serper returned no organic results", "empty");
    }

    const features = serpFeaturesFromResponse(data);

    return organic.slice(0, limit).map((r, idx) => {
      const url = r.link ?? "";
      return {
        position: r.position ?? idx + 1,
        url,
        domain: domainOf(url),
        title: r.title ?? "",
        snippet: r.snippet ?? "",
        serp_features: features.length > 0 ? features : undefined,
      };
    });
  } catch (err) {
    if (err instanceof SerperError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SerperError(
        `Serper timed out after ${REQUEST_TIMEOUT_MS}ms`,
        "upstream_error",
        undefined,
        err
      );
    }
    throw new SerperError(
      err instanceof Error ? err.message : String(err),
      "upstream_error",
      undefined,
      err
    );
  } finally {
    clearTimeout(timer);
  }
}
