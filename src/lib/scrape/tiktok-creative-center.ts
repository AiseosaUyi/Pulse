// TikTok hashtag scraper — top videos per hashtag.
//
// Originally targeted TikTok Creative Center but that requires cookies from
// a logged-in CC session (same ban risk as LinkedIn automation). Pivoted to
// hashtag-based scraping via Clockworks' actor, which parallels the
// Instagram setup: tenant provides hashtags, we return top videos per tag.
//
// Setup (in Vercel env):
//   APIFY_TIKTOK_ACTOR_ID  — e.g. 'clockworks~tiktok-hashtag-scraper'
//   (APIFY_API_TOKEN is shared with the Instagram scraper)

import { ApifyClient } from "apify-client";
import {
  type ActorItem,
  probe,
  extractHashtagsFromText,
  truncate,
} from "@/lib/scrape/helpers";

export interface ScrapedTrend {
  platform: "tiktok" | "instagram" | "twitter";
  source: "creative_center" | "hashtag_scout";
  hashtag?: string;
  title: string;
  summary: string;
  external_url?: string;
  views?: number;
  likes?: number;
  comments?: number;
  engagement_rate?: number;
  trending_rank?: number;
  region?: string;
  owner_handle?: string;
}

// Shared parser logic lives in ./helpers. This file just knows clockworks'
// input/output conventions for the TikTok actor.

export async function scrapeTikTokTopPosts(
  hashtags: string[],
  opts: { limitPerHashtag?: number } = {}
): Promise<ScrapedTrend[]> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_TIKTOK_ACTOR_ID;
  const limit = opts.limitPerHashtag ?? 5;

  if (!token || !actorId) {
    console.log(
      "[scrape/tiktok] APIFY_API_TOKEN or APIFY_TIKTOK_ACTOR_ID missing — returning no posts"
    );
    return [];
  }
  if (hashtags.length === 0) return [];

  const client = new ApifyClient({ token });

  try {
    const cleaned = hashtags.map((h) =>
      h.trim().replace(/^#/, "").toLowerCase()
    );

    // clockworks/tiktok-hashtag-scraper shape. Adjust per actor README if using a
    // different one.
    const run = await client.actor(actorId).call(
      {
        hashtags: cleaned,
        resultsPerPage: limit,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      },
      { timeout: 180, memory: 1024 }
    );

    if (!run.defaultDatasetId) {
      console.warn("[scrape/tiktok] actor run had no dataset");
      return [];
    }

    const { items } = await client
      .dataset(run.defaultDatasetId)
      .listItems({ limit: limit * cleaned.length * 3 });

    // Group by hashtag. Probe explicit hashtags field first, then parse from caption.
    const grouped = new Map<string, ActorItem[]>();
    for (const rawItem of items as ActorItem[]) {
      const caption =
        probe<string>(rawItem, "text", "caption", "description") ?? "";
      const rawTags = probe<Array<string | { name?: string }>>(rawItem, "hashtags") ?? [];
      const explicitTags = rawTags.map((h) =>
        typeof h === "string" ? h.toLowerCase() : (h?.name ?? "").toLowerCase()
      );
      const parsedTags = extractHashtagsFromText(caption);
      const postTags = [...explicitTags, ...parsedTags];

      const matchedTag =
        cleaned.find((h) => postTags.includes(h)) ?? cleaned[0];
      const bucket = grouped.get(matchedTag) ?? [];
      bucket.push(rawItem);
      grouped.set(matchedTag, bucket);
    }

    const out: ScrapedTrend[] = [];
    for (const [tag, list] of grouped) {
      const sorted = [...list].sort((a, b) => {
        const va = probe<number>(a, "playCount", "videoPlayCount", "views") ?? 0;
        const vb = probe<number>(b, "playCount", "videoPlayCount", "views") ?? 0;
        return vb - va;
      });
      for (const item of sorted.slice(0, limit)) {
        const views = probe<number>(item, "playCount", "videoPlayCount", "views");
        const likes = probe<number>(item, "diggCount", "likesCount");
        const comments = probe<number>(item, "commentCount", "commentsCount");
        const owner = probe<string>(
          item,
          "authorMeta.name",
          ["authorMeta", "name"],
          "authorMeta.nickName",
          ["authorMeta", "nickName"],
          ["author", "uniqueId"],
          ["author", "nickname"],
          "username"
        );
        const url = probe<string>(item, "webVideoUrl", "videoUrl", "url");
        const caption = probe<string>(item, "text", "caption", "description") ?? "";

        out.push({
          platform: "tiktok",
          source: "hashtag_scout",
          hashtag: `#${tag}`,
          title: owner ? `@${owner} · #${tag}` : `#${tag}`,
          summary: truncate(caption || `Top TikTok for #${tag}`, 280),
          external_url: url,
          views,
          likes,
          comments,
          owner_handle: owner,
        });
      }
    }

    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scrape/tiktok] Apify call failed", {
      actorId,
      hashtagCount: hashtags.length,
      message,
    });
    throw new Error(`TikTok scrape failed: ${message}`);
  }
}

// Kept for backward-compat with the previous file name; the two scrapers
// have the same interface now.
export const scrapeTikTokCreativeCenter = scrapeTikTokTopPosts;
