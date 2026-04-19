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
