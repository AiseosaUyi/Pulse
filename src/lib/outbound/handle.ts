// Shared platform / handle detection. Mirrors extension/lib/detect.js
// so the Chrome extension (runtime: browser, ES module) and the
// server-side discovery engine stay in lockstep.
//
// Returns null for URLs that look like posts, hashtags, admin routes,
// or anything else that isn't a profile.

import type { OutboundPlatform, SignalType } from "@/lib/types/outbound";

export interface DetectedProspect {
  platform: OutboundPlatform;
  handle: string;
  profileUrl: string;
}

const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "direct",
  "accounts",
  "stories",
  "tv",
]);

const TW_RESERVED = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "i",
  "search",
  "settings",
  "compose",
]);

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function detectFromUrl(url: string): DetectedProspect | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);

  if (host === "instagram.com") {
    const first = parts[0];
    if (!first || IG_RESERVED.has(first)) return null;
    const handle = normalizeHandle(first);
    if (!handle || handle.length > 40) return null;
    return {
      platform: "instagram",
      handle,
      profileUrl: `https://www.instagram.com/${handle}/`,
    };
  }

  if (host === "tiktok.com") {
    const first = parts[0];
    if (!first || !first.startsWith("@")) return null;
    const handle = normalizeHandle(first);
    if (!handle || handle.length > 40) return null;
    return {
      platform: "tiktok",
      handle,
      profileUrl: `https://www.tiktok.com/@${handle}`,
    };
  }

  if (host === "twitter.com" || host === "x.com") {
    const first = parts[0];
    if (!first || TW_RESERVED.has(first)) return null;
    const handle = normalizeHandle(first);
    if (!handle || handle.length > 40) return null;
    return {
      platform: "twitter",
      handle,
      profileUrl: `https://twitter.com/${handle}`,
    };
  }

  if (host === "linkedin.com") {
    if (parts[0] !== "in" || !parts[1]) return null;
    const handle = normalizeHandle(parts[1]);
    if (!handle || handle.length > 80) return null;
    return {
      platform: "linkedin",
      handle,
      profileUrl: `https://www.linkedin.com/in/${handle}/`,
    };
  }

  return null;
}

function siteScopeFor(platform: OutboundPlatform): string {
  switch (platform) {
    case "instagram":
      return "site:instagram.com";
    case "tiktok":
      return "site:tiktok.com";
    case "twitter":
      return "(site:twitter.com OR site:x.com)";
    case "linkedin":
      return "site:linkedin.com/in";
    default:
      return "";
  }
}

/**
 * Google-site-search query builder for a given platform + signal type.
 * The signal type genuinely reshapes the query (not just a label on the
 * result afterward) — each one targets a different kind of bio/caption
 * language a real profile would use for that signal.
 */
export function siteSearchQueryFor(
  platform: OutboundPlatform,
  userQuery: string,
  signalType: SignalType = "keyword"
): string {
  const clean = userQuery.trim();
  const scope = siteScopeFor(platform);
  const withScope = (terms: string) => (scope ? `${scope} ${terms}` : terms);

  switch (signalType) {
    case "hashtag": {
      // A hashtag is a literal token, not freeform keyword text — quote it
      // so Google treats it as an exact tag rather than fuzzy-matching the
      // individual words.
      const tag = clean.replace(/^#/, "");
      return withScope(`"#${tag}"`);
    }
    case "event_host":
      return withScope(`${clean} (organizer OR "event host" OR "hosted by" OR promoter)`);
    case "event_attendee":
      return withScope(`${clean} (attended OR "was at" OR guestlist OR "had a blast at")`);
    case "recent_post":
      // Google SERP has no reliable recency operator via site-search alone;
      // biasing toward posts that read as recent activity is the best a
      // plain query can do without a dedicated recency API.
      return withScope(`${clean} (today OR "this week" OR tonight)`);
    case "ticketing_platform":
      // Ticketing-platform organizers live on ticketing sites, not social
      // profile pages — a generic site-search against a social platform is
      // the wrong tool for this signal. Real support is the event-platform
      // scraper (src/lib/scrape/event-platforms), not this query builder.
      return withScope(clean);
    case "manual":
    case "keyword":
    default:
      return withScope(clean);
  }
}
