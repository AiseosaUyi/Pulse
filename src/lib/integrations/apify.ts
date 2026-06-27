// Thin Apify API wrapper for X (Twitter) intelligence scraping.
// Actors used:
//   - keyword search + account timelines: apidojo/tweet-scraper (~$0.18/1K tweets)
//   - Env: APIFY_API_TOKEN

const APIFY_BASE = "https://api.apify.com/v2";
const TWEET_SCRAPER_ACTOR = process.env.APIFY_X_ACTOR_ID ?? "apidojo~tweet-scraper";

export interface ApifyTweet {
  id: string;
  text: string;
  url: string;
  author: {
    userName: string;
    name: string;
    followers: number;
  };
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  createdAt: string;
}

interface ApifyRunResult {
  data: { items: ApifyTweet[] };
}

export function isApifyConfigured(): boolean {
  return !!process.env.APIFY_API_TOKEN;
}

async function runActor(input: Record<string, unknown>): Promise<ApifyTweet[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  // Start a synchronous run (waits for completion, up to 120s).
  const res = await fetch(
    `${APIFY_BASE}/acts/${TWEET_SCRAPER_ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=120`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed: ${res.status} — ${text.slice(0, 200)}`);
  }

  const items = (await res.json()) as ApifyTweet[];
  return Array.isArray(items) ? items : [];
}

export async function searchTweets(
  query: string,
  minLikes: number,
  maxResults = 25
): Promise<ApifyTweet[]> {
  return runActor({
    searchTerms: [query],
    maxItems: maxResults,
    minimumFavorites: minLikes,
    lang: "en",
    includeReplies: false,
  });
}

export async function getAccountTimeline(
  handle: string,
  maxResults = 30
): Promise<ApifyTweet[]> {
  return runActor({
    twitterHandles: [handle],
    maxItems: maxResults,
    includeReplies: false,
    includeRetweets: false,
  });
}
