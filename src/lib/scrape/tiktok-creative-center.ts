// TikTok Creative Center scraper, backed by an Apify actor.
//
// Setup (done once in Vercel env):
//   APIFY_API_TOKEN          — from https://console.apify.com/account/integrations
//   APIFY_TIKTOK_ACTOR_ID    — the actor slug, e.g. 'clockworks~tiktok-trending-hashtags'
//                              (browse the marketplace at https://apify.com/store, search
//                              "TikTok Creative Center" or "TikTok trending hashtags")
//   APIFY_TIKTOK_REGION      — optional country code, default 'NG'. The actor's input
//                              shape may differ per actor — see their README.
//
// If either of the first two env vars is missing, the function returns an empty
// array so the cron still runs cleanly; the UI just shows nothing new.
//
// Cost per run: ~$0.003–0.01 depending on actor and volume. Weekly cron = ~$0.01–0.04/mo.

import { ApifyClient } from "apify-client";

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
  region?: string;
  limit?: number;
}

interface ActorItem {
  hashtag?: string;
  tag?: string;
  name?: string;
  title?: string;
  publishCnt?: number;
  videos?: number;
  posts?: number;
  views?: number;
  viewCount?: number;
  rank?: number;
  trending_rank?: number;
  url?: string;
  link?: string;
  [k: string]: unknown;
}

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function pickNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function normalizeItem(item: ActorItem, idx: number, region: string): ScrapedTrend | null {
  const hashtag = pickString(item.hashtag, item.tag, item.name, item.title);
  if (!hashtag) return null;

  const views = pickNumber(item.publishCnt, item.videos, item.posts, item.views, item.viewCount);
  const rank = pickNumber(item.rank, item.trending_rank) ?? idx + 1;
  const url = pickString(item.url, item.link);

  const cleanTag = hashtag.startsWith("#") ? hashtag : `#${hashtag}`;
  const summary = views
    ? `Trending #${cleanTag.replace(/^#/, "")} in ${region} (${views.toLocaleString()} videos, rank ${rank}).`
    : `Trending #${cleanTag.replace(/^#/, "")} in ${region} (rank ${rank}).`;

  return {
    platform: "tiktok",
    hashtag: cleanTag,
    title: cleanTag,
    summary,
    external_url: url,
    views,
    trending_rank: rank,
    region,
  };
}

export async function scrapeTikTokCreativeCenter(
  opts: ScrapeOptions = {}
): Promise<ScrapedTrend[]> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_TIKTOK_ACTOR_ID;
  const region = opts.region ?? process.env.APIFY_TIKTOK_REGION ?? "NG";
  const limit = opts.limit ?? 20;

  if (!token || !actorId) {
    console.log(
      "[scrape/tiktok] APIFY_API_TOKEN or APIFY_TIKTOK_ACTOR_ID missing — returning no trends"
    );
    return [];
  }

  const client = new ApifyClient({ token });

  try {
    // Most TikTok Creative Center actors accept {country, limit} or similar.
    // If the chosen actor needs a different shape, override via actor docs.
    const run = await client.actor(actorId).call(
      { country: region, region, limit, maxItems: limit },
      { timeout: 120, memory: 1024 }
    );

    if (!run.defaultDatasetId) {
      console.warn("[scrape/tiktok] actor run had no dataset");
      return [];
    }

    const { items } = await client
      .dataset(run.defaultDatasetId)
      .listItems({ limit });

    return (items as ActorItem[])
      .map((item, i) => normalizeItem(item, i, region))
      .filter((t): t is ScrapedTrend => t !== null)
      .slice(0, limit);
  } catch (err) {
    console.error("[scrape/tiktok] Apify call failed", {
      actorId,
      region,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
