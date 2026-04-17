// Instagram top-posts-by-hashtag scraper.
//
// Setup (done once in Vercel env):
//   APIFY_INSTAGRAM_ACTOR_ID  — e.g. 'apify~instagram-scraper'
//   (APIFY_API_TOKEN is shared with the TikTok scraper)
//
// Returns the top N posts/reels per hashtag by engagement. The cron passes
// per-tenant hashtag lists from tenants.settings.scout_config.instagram_hashtags.

import { ApifyClient } from "apify-client";
import type { ScrapedTrend } from "@/lib/scrape/tiktok-creative-center";

interface ActorItem {
  id?: string;
  url?: string;
  type?: string;
  caption?: string;
  hashtags?: string[];
  ownerUsername?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  timestamp?: string;
  [k: string]: unknown;
}

function first<T>(v: T | T[] | undefined): T | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export async function scrapeInstagramTopPosts(
  hashtags: string[],
  opts: { limitPerHashtag?: number } = {}
): Promise<ScrapedTrend[]> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_INSTAGRAM_ACTOR_ID;
  const limit = opts.limitPerHashtag ?? 5;

  if (!token || !actorId) {
    console.log(
      "[scrape/instagram] APIFY_API_TOKEN or APIFY_INSTAGRAM_ACTOR_ID missing — returning no posts"
    );
    return [];
  }
  if (hashtags.length === 0) return [];

  const client = new ApifyClient({ token });

  try {
    const cleaned = hashtags.map((h) =>
      h.trim().replace(/^#/, "").toLowerCase()
    );

    // apify/instagram-scraper input shape. Adjust per actor README if using a
    // different one.
    const run = await client.actor(actorId).call(
      {
        hashtags: cleaned,
        resultsType: "posts",
        resultsLimit: limit * cleaned.length,
        searchType: "hashtag",
      },
      { timeout: 180, memory: 1024 }
    );

    if (!run.defaultDatasetId) {
      console.warn("[scrape/instagram] actor run had no dataset");
      return [];
    }

    const { items } = await client
      .dataset(run.defaultDatasetId)
      .listItems({ limit: limit * cleaned.length * 2 });

    // Group by hashtag, take top N by engagement (likes + comments), format.
    const grouped = new Map<string, ActorItem[]>();
    for (const rawItem of items as ActorItem[]) {
      const tags = rawItem.hashtags ?? [];
      const matchedTag = first(cleaned.find((h) => tags.includes(h))) ?? cleaned[0];
      const bucket = grouped.get(matchedTag) ?? [];
      bucket.push(rawItem);
      grouped.set(matchedTag, bucket);
    }

    const out: ScrapedTrend[] = [];
    for (const [tag, list] of grouped) {
      const sorted = [...list].sort((a, b) => {
        const ea = (a.likesCount ?? 0) + (a.commentsCount ?? 0);
        const eb = (b.likesCount ?? 0) + (b.commentsCount ?? 0);
        return eb - ea;
      });
      for (const item of sorted.slice(0, limit)) {
        const likes = item.likesCount ?? 0;
        const comments = item.commentsCount ?? 0;
        const views = item.videoPlayCount ?? item.videoViewCount;
        const caption = item.caption ?? "";
        out.push({
          platform: "instagram",
          source: "hashtag_scout",
          hashtag: `#${tag}`,
          title: item.ownerUsername
            ? `@${item.ownerUsername} · #${tag}`
            : `#${tag}`,
          summary: truncate(caption.trim() || `Top post for #${tag}`, 280),
          external_url: item.url,
          views,
          likes,
          comments,
          owner_handle: item.ownerUsername,
        });
      }
    }

    return out;
  } catch (err) {
    console.error("[scrape/instagram] Apify call failed", {
      actorId,
      hashtagCount: hashtags.length,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
