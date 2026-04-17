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

interface ActorItem {
  id?: string;
  webVideoUrl?: string;
  videoUrl?: string;
  url?: string;
  text?: string;
  caption?: string;
  description?: string;
  hashtags?: Array<string | { name?: string }>;
  authorMeta?: { name?: string; nickName?: string };
  author?: { uniqueId?: string; nickname?: string };
  username?: string;
  playCount?: number;
  videoPlayCount?: number;
  views?: number;
  diggCount?: number;
  likesCount?: number;
  commentCount?: number;
  commentsCount?: number;
  shareCount?: number;
  [k: string]: unknown;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function pickNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

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

    // Group by hashtag, top N by engagement.
    const grouped = new Map<string, ActorItem[]>();
    for (const rawItem of items as ActorItem[]) {
      const tags =
        rawItem.hashtags?.map((h) =>
          typeof h === "string" ? h : h?.name ?? ""
        ) ?? [];
      const matchedTag =
        cleaned.find((h) => tags.map((t) => t.toLowerCase()).includes(h)) ??
        cleaned[0];
      const bucket = grouped.get(matchedTag) ?? [];
      bucket.push(rawItem);
      grouped.set(matchedTag, bucket);
    }

    const out: ScrapedTrend[] = [];
    for (const [tag, list] of grouped) {
      const sorted = [...list].sort((a, b) => {
        const va = pickNumber(a.playCount, a.videoPlayCount, a.views) ?? 0;
        const vb = pickNumber(b.playCount, b.videoPlayCount, b.views) ?? 0;
        return vb - va;
      });
      for (const item of sorted.slice(0, limit)) {
        const views = pickNumber(item.playCount, item.videoPlayCount, item.views);
        const likes = pickNumber(item.diggCount, item.likesCount);
        const comments = pickNumber(item.commentCount, item.commentsCount);
        const owner = pickString(
          item.authorMeta?.name,
          item.authorMeta?.nickName,
          item.author?.uniqueId,
          item.author?.nickname,
          item.username
        );
        const url = pickString(item.webVideoUrl, item.videoUrl, item.url);
        const caption = pickString(item.text, item.caption, item.description) ?? "";

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
    console.error("[scrape/tiktok] Apify call failed", {
      actorId,
      hashtagCount: hashtags.length,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// Kept for backward-compat with the previous file name; the two scrapers
// have the same interface now.
export const scrapeTikTokCreativeCenter = scrapeTikTokTopPosts;
