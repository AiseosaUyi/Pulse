import "server-only";

// Fetch / search social posts via Apify, to (a) infer a user's voice from their
// handle and (b) discover posts worth engaging with. Degrades gracefully:
// returns { configured: false } until the relevant actor id env is set.
//
// Wired actors (each pay-per-event on Apify — your token is billed per run):
//   X            → apidojo/tweet-scraper   (input: twitterHandles | searchTerms, maxItems, sort)
//   LinkedIn me  → harvestapi/linkedin-profile-posts (input: targetUrls, maxPosts)
//   LinkedIn find→ harvestapi/linkedin-post-search   (input: searchQueries, maxPosts)
//
// Env (actor id format "username~actor-name"):
//   APIFY_X_ACTOR_ID, APIFY_LINKEDIN_PROFILE_ACTOR_ID, APIFY_LINKEDIN_SEARCH_ACTOR_ID

import { runActorSync } from "@/lib/scrape/apify-rest";

function postText(it: Record<string, unknown>): string {
  return String(it.text ?? it.content ?? it.postText ?? it.full_text ?? it.caption ?? "").trim();
}

function postHandle(it: Record<string, unknown>): string | null {
  const author = it.author as Record<string, unknown> | undefined;
  return (
    (author?.userName as string) ??
    (author?.username as string) ??
    (author?.publicIdentifier as string) ??
    (it.authorHandle as string) ??
    (it.handle as string) ??
    (it.username as string) ??
    null
  );
}

function postUrl(it: Record<string, unknown>): string | null {
  return (it.url as string) ?? (it.postUrl as string) ?? (it.linkedinUrl as string) ?? null;
}

export type FetchHandleResult = { configured: false } | { configured: true; posts: string[] };

/** Recent posts authored by a handle, for voice inference. */
export async function fetchHandlePosts(
  platform: "x" | "linkedin",
  handle: string
): Promise<FetchHandleResult> {
  const token = process.env.APIFY_API_TOKEN;
  const clean = handle.replace(/^@/, "").trim();

  if (platform === "x") {
    const actorId = process.env.APIFY_X_ACTOR_ID;
    if (!token || !actorId) return { configured: false };
    const items = await runActorSync<Record<string, unknown>>({
      token,
      actorId,
      input: { twitterHandles: [clean], maxItems: 30, sort: "Latest" },
      timeout: 120,
      memory: 512,
    });
    return { configured: true, posts: items.map(postText).filter(Boolean) };
  }

  const actorId = process.env.APIFY_LINKEDIN_PROFILE_ACTOR_ID;
  if (!token || !actorId) return { configured: false };
  const items = await runActorSync<Record<string, unknown>>({
    token,
    actorId,
    input: { targetUrls: [`https://www.linkedin.com/in/${clean}`], maxPosts: 30 },
    timeout: 120,
    memory: 512,
  });
  return { configured: true, posts: items.map(postText).filter(Boolean) };
}

export interface DiscoveredPost {
  handle: string | null;
  content: string;
  url: string | null;
}

export type SearchResult = { configured: false } | { configured: true; posts: DiscoveredPost[] };

/** Search a platform for recent posts matching topic queries (best-effort, graceful). */
export async function searchPosts(
  platform: "x" | "linkedin",
  queries: string[],
  maxItems = 40
): Promise<SearchResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token || queries.length === 0) return { configured: false };

  if (platform === "x") {
    const actorId = process.env.APIFY_X_ACTOR_ID;
    if (!actorId) return { configured: false };
    const items = await runActorSync<Record<string, unknown>>({
      token,
      actorId,
      input: { searchTerms: queries.slice(0, 8), maxItems, sort: "Latest" },
      timeout: 120,
      memory: 512,
    });
    return {
      configured: true,
      posts: items
        .map((it) => ({ handle: postHandle(it), content: postText(it), url: postUrl(it) }))
        .filter((p) => p.content.length > 0),
    };
  }

  const actorId = process.env.APIFY_LINKEDIN_SEARCH_ACTOR_ID;
  if (!actorId) return { configured: false };
  const items = await runActorSync<Record<string, unknown>>({
    token,
    actorId,
    input: { searchQueries: queries.slice(0, 8), maxPosts: maxItems, sortBy: "date" },
    timeout: 120,
    memory: 512,
  });
  return {
    configured: true,
    posts: items
      .map((it) => ({ handle: postHandle(it), content: postText(it), url: postUrl(it) }))
      .filter((p) => p.content.length > 0),
  };
}
