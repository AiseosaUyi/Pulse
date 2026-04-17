// Instagram top-posts-by-hashtag scraper.
//
// Setup (done once in Vercel env):
//   APIFY_INSTAGRAM_ACTOR_ID  — e.g. 'apify~instagram-scraper'
//   (APIFY_API_TOKEN is shared with the TikTok scraper)
//
// Returns the top N posts/reels per hashtag by engagement. The cron passes
// per-tenant hashtag lists from tenants.settings.scout_config.instagram_hashtags.

import { runActorSync } from "@/lib/scrape/apify-rest";
import {
  type ActorItem,
  probe,
  extractHashtagsFromText,
  truncate,
} from "@/lib/scrape/helpers";
import type { ScrapedTrend } from "@/lib/scrape/tiktok-creative-center";

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

  try {
    const cleaned = hashtags.map((h) =>
      h.trim().replace(/^#/, "").toLowerCase()
    );

    // apify/instagram-scraper input shape:
    // - directUrls (array of explore/tags URLs) → one run covers all hashtags
    // - resultsType: 'posts' | 'stories' | etc.
    // - resultsLimit: total cap across all URLs
    const directUrls = cleaned.map(
      (h) => `https://www.instagram.com/explore/tags/${h}/`
    );
    const items = await runActorSync<ActorItem>({
      token,
      actorId,
      input: {
        directUrls,
        resultsType: "posts",
        resultsLimit: limit * cleaned.length,
      },
      timeout: 180,
      memory: 1024,
    });

    // Group by hashtag. IG doesn't always return a hashtags array; parse from
    // caption (captions reliably include the hashtags).
    const grouped = new Map<string, ActorItem[]>();
    for (const rawItem of items) {
      const caption =
        probe<string>(rawItem, "caption", "text", "description") ?? "";
      const rawTags =
        probe<Array<string | { name?: string }>>(rawItem, "hashtags") ?? [];
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
        const ea =
          (probe<number>(a, "likesCount", "likeCount") ?? 0) +
          (probe<number>(a, "commentsCount", "commentCount") ?? 0);
        const eb =
          (probe<number>(b, "likesCount", "likeCount") ?? 0) +
          (probe<number>(b, "commentsCount", "commentCount") ?? 0);
        return eb - ea;
      });
      for (const item of sorted.slice(0, limit)) {
        const likes = probe<number>(item, "likesCount", "likeCount") ?? 0;
        const comments = probe<number>(item, "commentsCount", "commentCount") ?? 0;
        const views = probe<number>(
          item,
          "videoPlayCount",
          "videoViewCount",
          "playCount"
        );
        const owner = probe<string>(item, "ownerUsername", "username", "owner.username");
        const url = probe<string>(item, "url", "shortcode_url", "permalink");
        const caption = probe<string>(item, "caption", "text", "description") ?? "";

        out.push({
          platform: "instagram",
          source: "hashtag_scout",
          hashtag: `#${tag}`,
          title: owner ? `@${owner} · #${tag}` : `#${tag}`,
          summary: truncate(caption.trim() || `Top post for #${tag}`, 280),
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
    console.error("[scrape/instagram] Apify call failed", {
      actorId,
      hashtagCount: hashtags.length,
      message,
    });
    throw new Error(`Instagram scrape failed: ${message}`);
  }
}
