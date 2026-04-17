// TikTok Creative Center public page is a client-rendered React app. A raw
// HTML fetch returns an empty shell — the trending data is loaded via an
// internal API call from the browser. Three real options to populate this:
//
// 1. Apify actor (paid, ~$0.003/scrape — cheapest robust path).
//    pnpm add apify-client → await client.actor('...').call({ region: 'NG' })
//
// 2. Reverse-engineer the internal API endpoint (free, brittle — TikTok can
//    break it without notice).
//
// 3. ScrapeCreators / Firecrawl / another scraping service.
//
// Today this returns an empty array so the cron wires cleanly end-to-end.
// Wire in Option 1 when usage justifies the ~$1/month spend.

export interface ScrapedTrend {
  platform: "tiktok";
  hashtag: string;
  title: string;
  summary: string;
  external_url?: string;
  views?: number;
  trending_rank?: number;
  region?: string;
}

export interface ScrapeOptions {
  region?: string;  // e.g. 'NG', 'US', 'global'
  limit?: number;
}

export async function scrapeTikTokCreativeCenter(
  _opts: ScrapeOptions = {}
): Promise<ScrapedTrend[]> {
  // TODO: implement Apify/Firecrawl call here when budget allows.
  // For now: empty so cron runs without error.
  return [];
}
