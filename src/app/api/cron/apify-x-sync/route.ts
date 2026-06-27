// Cron: 4×/day — pulls X (Twitter) signals via Apify for all tenants that
// have x_intel_config.enabled = true. Ingests keyword matches, account
// timeline highlights, and trending keyword search results into x_signal_cards.
//
// Requires migration 071 and APIFY_API_TOKEN env var.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isApifyConfigured,
  searchTweets,
  getAccountTimeline,
} from "@/lib/integrations/apify";
import type { XIntelConfig } from "@/lib/types/x-intel";

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isApifyConfigured()) {
    return Response.json({ skipped: true, reason: "APIFY_API_TOKEN not set" });
  }

  const admin = createAdminClient();

  // Load all tenants with X listening enabled.
  const { data: tenants } = await admin
    .from("tenants")
    .select("slug, settings");

  if (!tenants?.length) return Response.json({ ingested: 0 });

  let ingested = 0;
  let errors = 0;

  for (const tenant of tenants) {
    const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
    const cfg = settings.x_intel_config as Partial<XIntelConfig> | undefined;

    if (!cfg?.enabled) continue;

    const keywords = cfg.keywords ?? [];
    const accounts = cfg.accounts ?? [];
    const minEng = cfg.min_engagement ?? 15;
    const slug = tenant.slug;

    // Run keyword searches, account timelines, and trending in parallel (4 concurrent)
    // to stay within Vercel's 300s function timeout even at max config.
    const tasks: Array<() => Promise<{ count: number; err: boolean }>> = [];

    // 1. Keyword searches (up to 20)
    for (const keyword of keywords.slice(0, 20)) {
      tasks.push(async () => {
        try {
          const tweets = await searchTweets(keyword, minEng, 20);
          let count = 0;
          for (const tweet of tweets) {
            await upsertSignal(admin, slug, {
              signal_type: "keyword",
              matched_keyword: keyword,
              account_handle: null,
              ...tweetToRow(tweet),
            });
            count++;
          }
          return { count, err: false };
        } catch (err) {
          console.error(`[apify-x-sync] keyword "${keyword}" for ${slug}:`, err instanceof Error ? err.message : err);
          return { count: 0, err: true };
        }
      });
    }

    // 2. Monitored account timelines (up to 30)
    for (const handle of accounts.slice(0, 30)) {
      tasks.push(async () => {
        try {
          const tweets = await getAccountTimeline(handle, 15);
          const sorted = tweets.sort((a, b) => b.likeCount - a.likeCount).slice(0, 5);
          let count = 0;
          for (const tweet of sorted) {
            if (tweet.likeCount < minEng) continue;
            await upsertSignal(admin, slug, {
              signal_type: "account_monitor",
              matched_keyword: null,
              account_handle: handle,
              ...tweetToRow(tweet),
            });
            count++;
          }
          return { count, err: false };
        } catch (err) {
          console.error(`[apify-x-sync] account @${handle} for ${slug}:`, err instanceof Error ? err.message : err);
          return { count: 0, err: true };
        }
      });
    }

    // 3. Trending — top-5 keywords as OR query
    if (keywords.length > 0) {
      const trendQuery = keywords.slice(0, 5).join(" OR ");
      tasks.push(async () => {
        try {
          const tweets = await searchTweets(trendQuery, minEng * 3, 10);
          let count = 0;
          for (const tweet of tweets) {
            await upsertSignal(admin, slug, {
              signal_type: "trending",
              matched_keyword: null,
              account_handle: null,
              ...tweetToRow(tweet),
            });
            count++;
          }
          return { count, err: false };
        } catch (err) {
          console.error(`[apify-x-sync] trending for ${slug}:`, err instanceof Error ? err.message : err);
          return { count: 0, err: true };
        }
      });
    }

    // Run with concurrency cap of 4 to avoid hammering Apify rate limits
    const CONCURRENCY = 4;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY).map((t) => t());
      const results = await Promise.all(batch);
      for (const r of results) {
        ingested += r.count;
        if (r.err) errors++;
      }
    }
  }

  return Response.json({ ingested, errors });
}

function tweetToRow(tweet: Awaited<ReturnType<typeof searchTweets>>[number]) {
  return {
    tweet_id: tweet.id,
    author_handle: tweet.author.userName,
    author_name: tweet.author.name,
    author_followers: tweet.author.followers,
    tweet_text: tweet.text,
    tweet_url: tweet.url,
    likes: tweet.likeCount,
    reposts: tweet.retweetCount,
    replies: tweet.replyCount,
    posted_at: tweet.createdAt,
  };
}

async function upsertSignal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  tenantSlug: string,
  row: Record<string, unknown>
) {
  await admin.from("x_signal_cards").upsert(
    { tenant_slug: tenantSlug, ...row },
    { onConflict: "tenant_slug,tweet_id", ignoreDuplicates: true }
  );
}
