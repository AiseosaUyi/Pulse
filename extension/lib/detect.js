// Given the URL of the current tab (or the page the content script
// is running in), figure out whether we're looking at a profile
// we can draft for. Returns { platform, handle, profileUrl } or null.

export function detectProspect(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);

    if (host === "instagram.com") {
      // instagram.com/<handle>/ (possibly /p/, /reel/, /explore/ — skip those)
      const first = parts[0];
      if (!first) return null;
      if (
        [
          "p",
          "reel",
          "reels",
          "explore",
          "direct",
          "accounts",
          "stories",
          "tv",
        ].includes(first)
      ) {
        return null;
      }
      return {
        platform: "instagram",
        handle: first,
        profileUrl: `https://www.instagram.com/${first}/`,
      };
    }

    if (host === "tiktok.com") {
      // tiktok.com/@<handle>
      const first = parts[0];
      if (!first || !first.startsWith("@")) return null;
      const handle = first.slice(1);
      return {
        platform: "tiktok",
        handle,
        profileUrl: `https://www.tiktok.com/@${handle}`,
      };
    }

    if (host === "twitter.com" || host === "x.com") {
      // twitter.com/<handle> — but skip /home, /explore, /notifications, etc.
      const first = parts[0];
      if (!first) return null;
      if (
        [
          "home",
          "explore",
          "notifications",
          "messages",
          "i",
          "search",
          "settings",
          "compose",
        ].includes(first)
      ) {
        return null;
      }
      return {
        platform: "twitter",
        handle: first,
        profileUrl: `https://twitter.com/${first}`,
      };
    }

    if (host === "linkedin.com") {
      // linkedin.com/in/<handle>/
      if (parts[0] !== "in" || !parts[1]) return null;
      return {
        platform: "linkedin",
        handle: parts[1],
        profileUrl: `https://www.linkedin.com/in/${parts[1]}/`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Reserved first-path segments across IG / TikTok / etc. These are
// product routes, not profile handles, so they must be rejected when
// harvesting anchors from hashtag/post/follower pages.
const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "direct",
  "accounts",
  "stories",
  "tv",
  "about",
  "legal",
  "terms",
  "privacy",
  "copyright_policy",
  "data_policy",
  "developer",
  "press",
  "jobs",
  "web",
  "graphql",
]);

const IG_HANDLE_RE = /^[a-zA-Z0-9._]{1,30}$/;

/**
 * Returns true when the current URL is an IG hashtag page
 * (/explore/tags/<tag>/ or /explore/search/keyword/?q=%23<tag>).
 */
export function isHashtagPage(url = location.href) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "instagram.com") return false;
    if (/^\/explore\/tags\/[^/]+/.test(u.pathname)) return true;
    if (u.pathname === "/explore/search/keyword/" && u.searchParams.get("q")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns the hashtag string (without #) when on a hashtag page,
 * null otherwise. For keyword-search pages, returns the decoded query
 * with any leading # stripped.
 */
export function currentHashtag(url = location.href) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "instagram.com") return null;
    const m = /^\/explore\/tags\/([^/]+)/.exec(u.pathname);
    if (m) return decodeURIComponent(m[1]).toLowerCase();
    if (u.pathname === "/explore/search/keyword/") {
      const q = u.searchParams.get("q") ?? "";
      return q.replace(/^#/, "").toLowerCase() || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns true on IG post/reel pages (/p/<id>/ or /reel/<id>/). */
export function isPostPage(url = location.href) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "instagram.com") return false;
    return /^\/(p|reel|reels)\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Returns true on IG followers/following pages. */
export function isFollowersPage(url = location.href) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "instagram.com") return false;
    return /^\/[^/]+\/(followers|following)\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Walk every anchor currently in the viewport-ish part of the DOM,
 * pull out IG profile handles, reject reserved slugs + duplicates.
 * Designed for hashtag / post / followers pages where we're NOT on
 * someone's profile — we're harvesting pointers to profiles.
 *
 * IG's post grid tiles are <a href="/p/<id>/"> with an <img alt="Photo
 * by @handle on ..."> inside. We use that alt pattern as the primary
 * handle source because the grid tile anchor itself points to the
 * post, not the author. On followers/following dialogs, anchors point
 * directly to profiles.
 */
export function extractVisibleHandles(root = document) {
  const handles = new Map(); // handle → { postUrl?: string }
  const anchors = root.querySelectorAll("a[href^='/']");

  for (const a of anchors) {
    const href = a.getAttribute("href") ?? "";
    const clean = href.split("?")[0].split("#")[0];
    const m = /^\/([a-zA-Z0-9._]{1,30})\/?$/.exec(clean);
    if (m) {
      const handle = m[1].toLowerCase();
      if (IG_RESERVED.has(handle)) continue;
      if (!IG_HANDLE_RE.test(handle)) continue;
      if (!handles.has(handle)) handles.set(handle, {});
    }

    // Post-tile path: <a href="/p/<id>/"> with <img alt="...@handle on..."> inside.
    const postMatch = /^\/(p|reel|reels)\/([^/?#]+)/.exec(clean);
    if (postMatch) {
      const img = a.querySelector("img[alt]");
      const alt = img?.getAttribute("alt") ?? "";
      const authorMatch = /by\s+@?([a-zA-Z0-9._]{1,30})\b/i.exec(alt);
      if (authorMatch) {
        const handle = authorMatch[1].toLowerCase();
        if (!IG_RESERVED.has(handle) && IG_HANDLE_RE.test(handle)) {
          const existing = handles.get(handle) ?? {};
          if (!existing.postUrl) {
            existing.postUrl = `https://www.instagram.com${clean}/`;
            handles.set(handle, existing);
          }
        }
      }
    }
  }

  return Array.from(handles.entries()).map(([handle, meta]) => ({
    platform: "instagram",
    handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
    postUrl: meta.postUrl ?? null,
  }));
}

/**
 * Scrape whatever profile metadata we can from the current page —
 * bio, display name, follower count. All platform DOMs change
 * frequently, so we try multiple selectors and return undefined on
 * miss rather than blowing up.
 */
export function scrapeProfileMeta(platform) {
  const result = {};
  try {
    if (platform === "instagram") {
      const title = document.querySelector("h1, h2");
      if (title) result.displayName = title.textContent?.trim();
      const meta = document.querySelector("meta[name='description']");
      if (meta) result.bio = meta.getAttribute("content")?.trim();
    }
    if (platform === "tiktok") {
      const title = document.querySelector("h1");
      if (title) result.displayName = title.textContent?.trim();
      const bio = document.querySelector("[data-e2e='user-bio']");
      if (bio) result.bio = bio.textContent?.trim();
    }
    if (platform === "twitter") {
      const name = document.querySelector("[data-testid='UserName']");
      if (name) result.displayName = name.textContent?.trim().split("@")[0];
      const bio = document.querySelector("[data-testid='UserDescription']");
      if (bio) result.bio = bio.textContent?.trim();
    }
    if (platform === "linkedin") {
      const name = document.querySelector("h1");
      if (name) result.displayName = name.textContent?.trim();
      const bio = document.querySelector("[data-generated-suggestion-target]");
      if (bio) result.bio = bio.textContent?.trim();
    }
  } catch {
    // Ignore — scraping is best-effort.
  }
  return result;
}
