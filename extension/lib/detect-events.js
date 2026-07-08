// Detection + scraping for the event-platform capture path — a SEPARATE
// system from lib/detect.js (IG/TikTok/X/LinkedIn profile capture).
// Confirmed via real-browser research (2026-07-08) that these 5 platforms
// have real event/organizer data but need a real browser to see it —
// backend scraping can't reach them, this extension can. Deliberately
// generic/tolerant rather than precise per-site selectors: DOM here was
// inspected via get_page_text (visible text), not exhaustively via exact
// element structure, so text-pattern matching is the honest, robust
// choice over selectors that would silently break on a redesign.

const EVENT_PLATFORM_HOSTS = {
  "clooza.com": "clooza",
  "www.clooza.com": "clooza",
  "tickethub.ng": "tickethub",
  "www.tickethub.ng": "tickethub",
  "app.eventpadi.com": "eventpadi",
  "eventporte.com": "eventporte",
  "www.eventporte.com": "eventporte",
  "tixvnt.com": "tixvnt",
  "www.tixvnt.com": "tixvnt",
  "selar.co": "selar",
  "www.selar.co": "selar",
};

const PLATFORM_LABELS = {
  clooza: "Clooza",
  tickethub: "Tickethub.ng",
  eventpadi: "Eventpadi",
  eventporte: "EventPorte",
  tixvnt: "Tixvnt",
  selar: "Selar",
};

// Paths that are never an event/organizer detail page, checked against
// the first path segment. Kept short and permissive — false negatives
// (FAB doesn't show) are a minor annoyance; false positives are worse
// (FAB shows on a login page and captures garbage).
const RESERVED_FIRST_SEGMENTS = new Set([
  "login",
  "signup",
  "register",
  "pricing",
  "about",
  "contact",
  "help",
  "faq",
  "terms",
  "privacy",
  "blog",
  "dashboard",
  "settings",
  "explore",
  "discover",
  "discovery",
  "events", // the listing page itself, not a specific event
  "event-details", // eventporte uses /event-details/<slug> — handled specially below
]);

export function detectEventPlatform(url = location.href) {
  try {
    const u = new URL(url);
    const platformId = EVENT_PLATFORM_HOSTS[u.hostname];
    if (!platformId) return null;

    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return null;
    const parts = path.split("/").filter(Boolean);
    const first = parts[0]?.toLowerCase();

    // EventPorte's real detail pages are /event-details/<slug> — that's
    // the one case where "event-details" being first is exactly right.
    if (platformId === "eventporte") {
      if (first === "event-details" && parts.length >= 2) {
        return { platformId, label: PLATFORM_LABELS[platformId], url };
      }
      return null;
    }

    // Tickethub / Tixvnt / Selar: a real event page is anything that
    // isn't a reserved marketing/account route.
    if (first && RESERVED_FIRST_SEGMENTS.has(first)) return null;

    // Clooza: single-segment paths are organizer profile pages
    // (clooza.com/<handle>) — the richest data source on that platform.
    if (platformId === "clooza") {
      const reserved = new Set(["en", "create", "history"]);
      if (parts.length === 0 || reserved.has(first)) return null;
      return { platformId, label: PLATFORM_LABELS[platformId], url, isProfilePage: true };
    }

    return { platformId, label: PLATFORM_LABELS[platformId], url };
  } catch {
    return null;
  }
}

const PRICE_RE = /(₦|₵|GH₵|NGN|USD)\s?[\d,]+(\.\d+)?|\$\s?[\d,]+(\.\d+)?/;

// These three are specific enough to safely scan the whole page body —
// "organized by X" / "hosted by X" / "by X" at line-start rarely appear
// by coincidence in unrelated text.
const ORGANIZER_PATTERNS = [
  /organi[sz]ed by[:\s]+([^\n.]{2,80})/i,
  /hosted by[:\s]+([^\n.]{2,80})/i,
  /^by\s+([^\n.]{2,80})/im,
];

// "X WITH Y" is too generic to scan the whole page body (confirmed live:
// matches garbage on unrelated sentences) — only ever try it against the
// event TITLE/heading text, where EventPorte's real pattern actually
// lives ("SUNDAY SERVICE WITH DEJI"), never the full body text.
const TITLE_WITH_RE = /\bwith\s+([A-Za-z][A-Za-z0-9 .'&-]{1,60})\b/i;

const SOCIAL_LINK_RE = /instagram\.com|twitter\.com|x\.com|linktr\.ee/i;

// Reads whatever the CURRENT rendered page shows — the browser has
// already done the JS execution/rendering a backend scraper can't.
// Prioritizes the human's own text selection over the auto-heuristic:
// if the operator highlighted the organizer's name before clicking
// Capture, that's a stronger signal than any regex.
export function scrapeEventPageMeta(target) {
  const bodyText = document.body.innerText || "";
  const selectedText = window.getSelection?.()?.toString()?.trim() || null;

  let eventTitle =
    document.querySelector("h1")?.textContent?.trim() || document.title || null;

  let organizerName = null;
  if (target.isProfilePage) {
    // Clooza profile page — the h1/h2 display name IS the organizer.
    organizerName =
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("h2")?.textContent?.trim() ||
      null;
    eventTitle = null; // no single event on a profile page
  } else {
    for (const re of ORGANIZER_PATTERNS) {
      const m = re.exec(bodyText);
      if (m) {
        organizerName = m[1].trim();
        break;
      }
    }
    if (!organizerName && eventTitle) {
      const m = TITLE_WITH_RE.exec(eventTitle);
      if (m) organizerName = m[1].trim();
    }
  }

  let organizerHandle = null;
  if (target.platformId === "clooza" && target.isProfilePage) {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length > 0) organizerHandle = parts[0];
  }

  const priceMatch = PRICE_RE.exec(bodyText);
  const priceRaw = priceMatch ? priceMatch[0].trim() : null;

  let socialUrl = null;
  const anchors = document.querySelectorAll("a[href]");
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (SOCIAL_LINK_RE.test(href)) {
      socialUrl = href;
      break;
    }
  }

  return {
    pageUrl: location.href,
    eventTitle,
    organizerName: selectedText || organizerName,
    organizerHandle,
    priceRaw,
    socialUrl,
  };
}
