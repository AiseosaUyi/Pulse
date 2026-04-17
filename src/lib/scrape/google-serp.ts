// Google SERP scraper via Apify.
//
// Setup: APIFY_SERP_ACTOR_ID env var (e.g. 'apify~google-search-scraper').
// Shares APIFY_API_TOKEN with TikTok + Instagram scrapers.

import { runActorSync } from "@/lib/scrape/apify-rest";
import { type ActorItem, probe } from "@/lib/scrape/helpers";

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

export async function scrapeGoogleSerp(
  input: ScrapeInput
): Promise<SerpResult[]> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_SERP_ACTOR_ID;
  const limit = input.limit ?? 10;

  if (!token || !actorId) {
    console.log(
      "[scrape/serp] APIFY_API_TOKEN or APIFY_SERP_ACTOR_ID missing — returning no results"
    );
    return [];
  }

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
