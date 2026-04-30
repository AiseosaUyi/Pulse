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
 * Legacy bulk-harvest — only called now by the manual "Capture visible"
 * fallback FAB. The passive observer uses the source-aware extractors
 * below (extractPostAuthorFromOverlay / extractCommentAuthorsWithText /
 * extractTaggedPeople) instead. This one is still broad: it trusts any
 * `/<handle>/` anchor on the page, EXCEPT anchors inside the sidebar,
 * story rings, or suggested-account sections which we now reject.
 */
export function extractVisibleHandles(root = document) {
  const handles = new Map(); // handle → { postUrl?: string }
  const anchors = root.querySelectorAll("a[href^='/']");

  for (const a of anchors) {
    if (isInSidebarOrRing(a)) continue;

    const href = a.getAttribute("href") ?? "";
    const clean = href.split("?")[0].split("#")[0];
    const m = /^\/([a-zA-Z0-9._]{1,30})\/?$/.exec(clean);
    if (m) {
      const handle = m[1].toLowerCase();
      if (IG_RESERVED.has(handle)) continue;
      if (!IG_HANDLE_RE.test(handle)) continue;
      if (!handles.has(handle)) handles.set(handle, {});
    }

    const postMatch = /^\/(p|reel|reels)\/([^/?#]+)/.exec(clean);
    if (postMatch) {
      const img = a.querySelector("img[alt]");
      const alt = img?.getAttribute("alt") ?? "";
      const authorMatch = /by\s+@([a-zA-Z0-9._]{2,30})\b/i.exec(alt);
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

// ──────────────────────────────────────────────────────────────
// IG DOM — versioned selector arrays
//
// Instagram reworks its DOM on a quarterly-ish cadence. Every
// selector below is kept in an array so callers iterate until the
// first match hits. When IG ships a redesign, bump `version` and
// append new selectors at the FRONT of the relevant array. The
// options page surfaces this version string so the user can tell
// at a glance which DOM generation their capture is targeting.
// ──────────────────────────────────────────────────────────────

export const IG_DOM_V = {
  version: "2026-04-a",
  // Root of an open post — the modal overlay takes precedence over
  // the main article because hashtag-page post clicks push a modal.
  postArticle: ['div[role="dialog"] article', "main article"],
  // Author profile link in the post header area.
  postAuthor: [
    'header a[role="link"][href^="/"]',
    "article header a[href^='/']",
  ],
  // Caption text — IG renders it in different nodes per surface.
  caption: [
    "article h1",
    'article ul li div[dir="auto"]',
    'article span[dir="auto"]',
  ],
  // Comment list items inside a post modal.
  commentLi: [
    'ul[aria-label*="Comment" i] li',
    "article ul li",
  ],
  // Time element for "x hours ago".
  time: ["time[datetime]"],
  // Tagged-people sheet (appears when user taps the photo).
  taggedSheet: ['div[role="dialog"]'],
  // Nodes that indicate we are inside a non-capture surface.
  reject: [
    "aside",
    "nav",
    '[role="navigation"]',
    '[aria-label*="Suggested" i]',
    '[aria-label*="Stories" i]',
    '[aria-label*="Story" i]',
  ],
};

function querySelectorFirst(root, selectors) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // Invalid selector in some browsers — skip.
    }
  }
  return null;
}

function querySelectorAllFirst(root, selectors) {
  for (const sel of selectors) {
    try {
      const els = root.querySelectorAll(sel);
      if (els && els.length > 0) return els;
    } catch {
      // noop
    }
  }
  return [];
}

export function isInSidebarOrRing(node) {
  if (!(node instanceof Element)) return false;
  for (const sel of IG_DOM_V.reject) {
    try {
      if (node.closest(sel)) return true;
    } catch {
      // noop
    }
  }
  return false;
}

export function getPostArticleRoot(doc = document) {
  return querySelectorFirst(doc, IG_DOM_V.postArticle);
}

export function isPostModalOpen(doc = document) {
  // A modal overlay is present AND it contains a post article.
  const modal = doc.querySelector('div[role="dialog"]');
  if (!modal) return false;
  return !!modal.querySelector("article");
}

/**
 * Decide where a handle anchor was found on the page. The passive
 * observer feeds every candidate anchor through this so only the
 * whitelisted surfaces produce captures.
 */
export function classifySource(node) {
  if (!(node instanceof Element)) return "unknown";
  if (isInSidebarOrRing(node)) {
    // Best-effort sub-classification for telemetry.
    if (node.closest('[aria-label*="Stor" i]')) return "story_ring";
    return "sidebar";
  }
  // Inside a comments list? Each li is a comment; its first profile
  // anchor is the commenter.
  const li = node.closest("li");
  if (li) {
    const ul = li.closest("ul");
    const ulLabel = ul?.getAttribute("aria-label") ?? "";
    if (/comment/i.test(ulLabel)) return "commenter";
    // Fallback: if we're inside an <article> ul and the node is the
    // first anchor in the li, treat it as a commenter. IG's newer
    // layouts sometimes omit the aria-label.
    if (li.closest("article")) return "commenter";
  }
  // Inside the tagged-people dialog.
  const dialog = node.closest('div[role="dialog"]');
  if (dialog) {
    const heading = dialog.querySelector("h1, h2, h3, h4");
    if (heading && /tag/i.test(heading.textContent ?? "")) {
      return "tagged";
    }
  }
  // Inside the post article header? → post author.
  const header = node.closest("header");
  if (header && header.closest("article")) return "post_author";
  return "unknown";
}

function extractHandleFromAnchor(anchor) {
  if (!(anchor instanceof Element)) return null;
  const href = anchor.getAttribute?.("href") ?? "";
  const clean = href.split("?")[0].split("#")[0];
  const m = /^\/([a-zA-Z0-9._]{2,30})\/?$/.exec(clean);
  if (!m) return null;
  const handle = m[1].toLowerCase();
  if (IG_RESERVED.has(handle)) return null;
  if (!IG_HANDLE_RE.test(handle)) return null;
  return handle;
}

/**
 * Pull the author handle, display name, caption, and timestamp out
 * of an open post modal (or /p/<id>/ page). Returns null if the
 * article doesn't look like a post (e.g. the dialog is something
 * else). Selectors are best-effort.
 */
export function extractPostAuthorFromOverlay(articleRoot) {
  if (!articleRoot) return null;
  const authorAnchor = querySelectorFirst(articleRoot, IG_DOM_V.postAuthor);
  if (!authorAnchor) return null;
  const handle = extractHandleFromAnchor(authorAnchor);
  if (!handle) return null;

  let displayName = null;
  const nameText = authorAnchor.textContent?.trim();
  if (nameText && nameText !== handle) displayName = nameText;

  const timeEl = querySelectorFirst(articleRoot, IG_DOM_V.time);
  const takenAt = timeEl?.getAttribute("datetime") ?? null;

  // Caption: try the explicit caption selectors, then fall back to
  // the first comment-like li which is where IG often parks it.
  let captionText = null;
  const h1 = articleRoot.querySelector("h1");
  if (h1) captionText = h1.textContent?.trim() ?? null;
  if (!captionText) {
    const nodes = querySelectorAllFirst(articleRoot, IG_DOM_V.caption);
    for (const n of nodes) {
      const txt = n.textContent?.trim();
      if (txt && txt.length > 20) {
        captionText = txt;
        break;
      }
    }
  }

  let postUrl = null;
  // If we're on a post page, the URL is the post. If we're in a
  // modal overlaid on a hashtag page, try to find a pretty link
  // inside the header — IG exposes a "copy link" or share anchor.
  if (typeof location !== "undefined" && /\/(p|reel|reels)\//.test(location.pathname)) {
    postUrl = `https://www.instagram.com${location.pathname}`;
  }

  return {
    handle,
    displayName,
    captionText,
    postUrl,
    takenAt,
  };
}

const COMMENT_MAX = 25;

/**
 * Walk comments inside an open post, returning `{handle, commentText}`
 * for up to COMMENT_MAX visible comments. The caller is expected to
 * filter by intersection/dwell — this one returns everything currently
 * in the DOM.
 */
export function extractCommentAuthorsWithText(articleRoot) {
  if (!articleRoot) return [];
  const lis = querySelectorAllFirst(articleRoot, IG_DOM_V.commentLi);
  const out = [];
  for (const li of lis) {
    if (out.length >= COMMENT_MAX) break;
    if (isInSidebarOrRing(li)) continue;
    const firstAnchor = li.querySelector("a[href^='/']");
    const handle = extractHandleFromAnchor(firstAnchor);
    if (!handle) continue;
    // Comment body: grab the text minus the author handle. IG uses
    // varied structures so fall back to textContent with the handle
    // stripped off the front.
    const raw = (li.textContent ?? "").replace(/\s+/g, " ").trim();
    const commentText = raw.replace(
      new RegExp(`^${handle}\\s*`, "i"),
      ""
    );
    const timeEl = li.querySelector("time[datetime]");
    const commentedAt = timeEl?.getAttribute("datetime") ?? null;
    if (commentText.length < 2) continue;
    out.push({ handle, commentText: commentText.slice(0, 500), commentedAt });
  }
  return out;
}

/**
 * When the tagged-people sheet is open inside a post modal, pull
 * the tagged-user handles. Returns [] if no sheet is open.
 */
export function extractTaggedPeople(doc = document) {
  const dialogs = doc.querySelectorAll('div[role="dialog"]');
  for (const d of dialogs) {
    const heading = d.querySelector("h1, h2, h3, h4");
    if (!heading || !/tag/i.test(heading.textContent ?? "")) continue;
    const anchors = d.querySelectorAll("a[href^='/']");
    const out = [];
    for (const a of anchors) {
      const handle = extractHandleFromAnchor(a);
      if (handle) out.push({ handle });
    }
    return out;
  }
  return [];
}

/**
 * Return the best intent-quote string given what we extracted from
 * the surface. Single-line, trimmed to 500 chars. Pure.
 */
export function extractIntentQuote({
  sourceType,
  captionText,
  commentText,
  altText,
}) {
  const pick =
    sourceType === "commenter"
      ? commentText || captionText || altText
      : captionText || altText || commentText;
  if (!pick) return null;
  const collapsed = String(pick).replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, 500);
}

/**
 * Wire an IntersectionObserver over comment `<li>` elements inside
 * a post article. The callback fires once per `li` after it has
 * stayed in viewport continuously for `dwellMs`. Returns a teardown
 * function. Observers are idempotent — call teardown and then re-
 * install when the post modal swaps.
 */
export function observePostCommentList(
  articleRoot,
  callback,
  { threshold = 0.5, dwellMs = 1200 } = {}
) {
  if (!articleRoot || typeof IntersectionObserver === "undefined") {
    return () => {};
  }
  const firstSeen = new WeakMap();
  const fired = new WeakSet();
  const timers = new Map();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (fired.has(el)) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
          if (!firstSeen.has(el)) firstSeen.set(el, Date.now());
          if (!timers.has(el)) {
            const t = setTimeout(() => {
              if (!fired.has(el)) {
                fired.add(el);
                try {
                  callback(el);
                } catch {
                  // keep observer alive
                }
              }
              timers.delete(el);
            }, dwellMs);
            timers.set(el, t);
          }
        } else {
          // Left viewport before dwell elapsed — cancel.
          const t = timers.get(el);
          if (t) {
            clearTimeout(t);
            timers.delete(el);
          }
          firstSeen.delete(el);
        }
      }
    },
    { threshold: [threshold] }
  );

  const lis = querySelectorAllFirst(articleRoot, IG_DOM_V.commentLi);
  for (const li of lis) io.observe(li);

  return () => {
    io.disconnect();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

/**
 * Local pre-score — the same filters page the operator edits in
 * Pulse are mirrored to the extension via /api/ext/outbound-filters.
 * This is a fast, offline classifier: does the candidate's bio /
 * caption / comment / intent quote overlap any user-configured
 * keyword, competitor URL, or geo region? Returns match lists and
 * a verdict the staging area uses to route the row.
 *
 * Verdicts:
 *   keep    — any keyword / competitor / geo hit
 *   defer   — high-trust source (post_author) with no hit; let the
 *             server qualifier decide
 *   discard — weaker source with no hit; auto-skip (visible to user
 *             in the "Auto-discarded" tab so they can audit misses)
 */
export function localPreScore(
  { bio, captionText, commentText, intentQuote, sourceType } = {},
  filters
) {
  const blob = [bio, captionText, commentText, intentQuote]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

  const matchedKeywords = [];
  const matchedCompetitors = [];
  const matchedGeo = [];

  if (filters && Array.isArray(filters.keywords)) {
    for (const kw of filters.keywords) {
      const k = String(kw ?? "").trim().toLowerCase();
      if (k.length === 0) continue;
      if (blob.includes(k)) matchedKeywords.push(k);
    }
  }
  if (filters && Array.isArray(filters.competitorUrls)) {
    for (const url of filters.competitorUrls) {
      const u = String(url ?? "").trim().toLowerCase();
      if (u.length === 0) continue;
      if (blob.includes(u)) matchedCompetitors.push(u);
    }
  }
  if (filters && Array.isArray(filters.geoScope)) {
    for (const region of filters.geoScope) {
      const country = String(region?.country ?? "").trim().toLowerCase();
      if (country && blob.includes(country)) matchedGeo.push(country);
      const states = Array.isArray(region?.states) ? region.states : [];
      for (const s of states) {
        const name = String(s ?? "").trim().toLowerCase();
        if (name.length > 2 && blob.includes(name)) {
          matchedGeo.push(name);
        }
      }
    }
  }

  const anyMatch =
    matchedKeywords.length > 0 ||
    matchedCompetitors.length > 0 ||
    matchedGeo.length > 0;

  let verdict;
  if (anyMatch) {
    verdict = "keep";
  } else if (sourceType === "post_author") {
    verdict = "defer";
  } else {
    verdict = "discard";
  }

  return {
    matchedKeywords: Array.from(new Set(matchedKeywords)),
    matchedCompetitors: Array.from(new Set(matchedCompetitors)),
    matchedGeo: Array.from(new Set(matchedGeo)),
    verdict,
  };
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
