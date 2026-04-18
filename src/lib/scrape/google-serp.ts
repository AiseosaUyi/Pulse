// Google SERP resolver. Two-tier:
//   1. Try Serper.dev (SERPER_API_KEY) — 2,500 free searches/month,
//      returns clean JSON in ~400ms, zero infrastructure cost.
//   2. If Serper isn't configured OR the call fails (rate limit,
//      quota exhausted, auth broken, etc.), fall back to the Apify
//      google-search-scraper actor (APIFY_SERP_ACTOR_ID).
//
// This keeps us on the free tier for normal load and only spends
// Apify credits as a safety net. Both paths converge on the same
// SerpResult[] shape so the orchestrator doesn't care which ran.

import { runActorSync } from "@/lib/scrape/apify-rest";
import { type ActorItem, probe } from "@/lib/scrape/helpers";
import {
  scrapeViaSerper,
  SerperError,
  isSerperConfigured,
} from "@/lib/scrape/serper-serp";

export interface SerpResult {
  position: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  serp_features?: string[];
}

interface ScrapeInput {
  query: string;
  region?: string;   // country code e.g. 'NG', 'US'
  limit?: number;    // top N organic results
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// apify/google-search-scraper returns nested structure; we normalize several
// common shapes to SerpResult.
function normalizeSearchResults(items: ActorItem[], limit: number): SerpResult[] {
  const out: SerpResult[] = [];
  for (const item of items) {
    // Shape A: single item with an organicResults array
    const organic = probe<ActorItem[]>(item, "organicResults", "organic_results");
    if (organic && Array.isArray(organic)) {
      organic.slice(0, limit).forEach((r, i) => {
        const url = probe<string>(r, "url", "link") ?? "";
        const title = probe<string>(r, "title") ?? "";
        if (!url) return;
        out.push({
          position: probe<number>(r, "position") ?? i + 1,
          url,
          domain: domainOf(url),
          title,
          snippet: probe<string>(r, "description", "snippet") ?? "",
          serp_features: probe<string[]>(r, "features"),
        });
      });
      if (out.length > 0) return out.slice(0, limit);
    }
    // Shape B: each dataset row is an individual result
    const url = probe<string>(item, "url", "link");
    const title = probe<string>(item, "title");
    if (url && title) {
      out.push({
        position: probe<number>(item, "position") ?? out.length + 1,
        url,
        domain: domainOf(url),
        title,
        snippet: probe<string>(item, "description", "snippet") ?? "",
      });
    }
  }
  return out.slice(0, limit);
}

/**
 * Public entry point. Dispatches to Serper (preferred) or Apify
 * (fallback). Returns an empty array ONLY when neither resolver is
 * configured — configured-but-failing cases throw so the caller can
 * surface the error.
 */
export async function scrapeGoogleSerp(
  input: ScrapeInput
): Promise<SerpResult[]> {
  const apifyConfigured =
    !!process.env.APIFY_API_TOKEN && !!process.env.APIFY_SERP_ACTOR_ID;

  // Primary path: Serper.
  if (isSerperConfigured()) {
    try {
      const results = await scrapeViaSerper(input);
      if (results.length > 0) return results;
      // Serper returned empty but didn't throw — odd but treat as a
      // reason to try Apify (maybe our query tripped a content policy).
      console.warn("[scrape/serp] Serper returned zero results, trying Apify");
    } catch (err) {
      const shouldFallback = err instanceof SerperError;
      console.warn("[scrape/serp] Serper failed, falling back to Apify", {
        status: err instanceof SerperError ? err.status : "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
      // Only propagate immediately if Apify isn't available to cover.
      if (!shouldFallback && !apifyConfigured) {
        throw err;
      }
    }
  }

  // Fallback path: Apify. Returns empty if not configured (matches
  // prior behavior so callers have a graceful degrade path).
  if (!apifyConfigured) {
    console.log(
      "[scrape/serp] neither Serper nor Apify configured — returning no results"
    );
    return [];
  }

  return scrapeViaApify(input);
}

async function scrapeViaApify(input: ScrapeInput): Promise<SerpResult[]> {
  const token = process.env.APIFY_API_TOKEN!;
  const actorId = process.env.APIFY_SERP_ACTOR_ID!;
  const limit = input.limit ?? 10;

  try {
    const items = await runActorSync<ActorItem>({
      token,
      actorId,
      input: {
        queries: input.query,
        maxPagesPerQuery: 1,
        resultsPerPage: limit,
        countryCode: input.region ?? "ng",
        languageCode: "en",
      },
      timeout: 120,
      memory: 1024,
    });
    return normalizeSearchResults(items, limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scrape/serp] Apify call failed", {
      actorId,
      query: input.query,
      message,
    });
    throw new Error(`SERP scrape failed: ${message}`);
  }
}
