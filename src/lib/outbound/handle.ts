// Shared platform / handle detection. Mirrors extension/lib/detect.js
// so the Chrome extension (runtime: browser, ES module) and the
// server-side discovery engine stay in lockstep.
//
// Returns null for URLs that look like posts, hashtags, admin routes,
// or anything else that isn't a profile.

import type { OutboundPlatform } from "@/lib/types/outbound";

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

/** Google-site-search query builder for a given platform. */
export function siteSearchQueryFor(
  platform: OutboundPlatform,
  userQuery: string
): string {
  const clean = userQuery.trim();
  switch (platform) {
    case "instagram":
      return `site:instagram.com ${clean}`;
    case "tiktok":
      return `site:tiktok.com ${clean}`;
    case "twitter":
      return `(site:twitter.com OR site:x.com) ${clean}`;
    case "linkedin":
      return `site:linkedin.com/in ${clean}`;
    default:
      return clean;
  }
}
