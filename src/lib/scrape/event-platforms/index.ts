// Registry of event/ticketing platforms considered for the self-hosted
// scraper (design doc: aiseosauyi-idahor-main-design-20260708-080402.md).
// Every platform from the founder's list plus landscape research is listed
// here with its actual DOM-research outcome (2026-07-08) — including the
// ones that turned out NOT to be buildable within the "no Playwright, no
// pre-paid proxy" cost constraint. This is the source of truth for "what's
// actually live vs. deferred and why" — see the final build checklist for
// the human-readable version.

import { showsNgConfig } from "./shows-ng";
import { egoticketsConfig } from "./egotickets";
import type { EventPlatformConfig, EventPlatformStatus } from "./types";

export type { EventCandidate, EventPlatformConfig, EventPlatformStatus } from "./types";

// Platforms with a working in-house parser (types.ts EventPlatformConfig).
const BUILT_CONFIGS: EventPlatformConfig[] = [showsNgConfig, egoticketsConfig];

// Platforms researched but NOT built as a full parser, with the reason.
// `unconfirmed` ones (real content, no confirmed listing page with a price
// signal) get the generic JSON-LD fallback wired in event-scraper-runner.ts
// rather than a bespoke parser — see generic-jsonld.ts for why.
export const RESEARCHED_NOT_BUILT: Array<{
  id: string;
  label: string;
  status: Exclude<EventPlatformStatus, "active">;
  researchNote: string;
  listingUrls: string[];
}> = [
  {
    id: "tixtango",
    label: "TixTango",
    status: "no_public_directory",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08, not just curl): the website is a pure marketing/download page — 'About Us', 'Product' (features/pricing), 'Download App'. Only 7 real interactive elements on the whole page. No event browsing surface exists on the web at all; the actual product (TikTok-style event feed) only exists inside the native mobile app. A browser extension cannot reach inside a native app — not fixable by any web-based method (Playwright, scraping API, or extension).",
    listingUrls: ["https://tixtango.com/"],
  },
  {
    id: "clooza",
    label: "Clooza",
    status: "extension_needed",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): genuinely real, rich web app once past the client-render — an 'Explore' feed with real events (title, organizer name + handle, engagement), and organizer PROFILE pages at a predictable clooza.com/<handle> URL with display name, bio, an external link (often Linktree — a strong secondary social-handle signal), and follower count. curl confirms this data is 100% client-fetched (16 words of real text vs. the full profile seen in a real browser) — genuinely needs a real browser, which is exactly what extension-based capture provides. Best candidate for the extension build alongside Tickethub.ng.",
    listingUrls: ["https://clooza.com/events"],
  },
  {
    id: "partyverse",
    label: "Partyverse",
    status: "no_public_directory",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): the /guests page is a marketing landing page with a phone-mockup graphic showing example events ('Lovers & Frnds', 'LAGOS TRIVIA NIGHT') — confirmed via accessibility tree that these are static images, not real clickable elements (only 5 real interactive elements on the page, all nav/app-store links). No web-based event browsing exists; the real product is app-only. Same conclusion as TixTango — not fixable by any web-based method. The IG-mention path (IG_MENTION_PLATFORMS below) remains the only automatable signal.",
    listingUrls: ["https://www.partyverse.com/guests"],
  },
  {
    id: "selar",
    label: "Selar",
    status: "extension_needed",
    researchNote:
      "627KB page, ~10 words of real text — fully client-rendered SPA (not re-verified live, but same signature as Clooza/Tickethub before verification). Not IG-native the way Clooza/Partyverse are (Selar is a broader digital-products platform, tickets are one feature) — a real-browser check (same as Clooza) would likely confirm this is extension-buildable too; not yet prioritized.",
    listingUrls: ["https://selar.co/"],
  },
  {
    id: "tickethub",
    label: "Tickethub.ng",
    status: "extension_needed",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): excellent real data once rendered — /discover shows real priced events (category, price, date, venue), and event detail pages show the organizer's real name directly ('by Justina Okafor'), not just a handle. curl only ever sees loading-shimmer skeletons (confirmed: 0 words of real content), so this absolutely needs a real browser. Arguably the single best extension-capture candidate of all 5 — organizer identity is literally printed on the page.",
    listingUrls: ["https://tickethub.ng/discover"],
  },
  {
    id: "eventpadi",
    label: "Eventpadi",
    status: "no_public_directory",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): loads fine in a real browser (the earlier curl TLS-reset was specifically a bot-detection response to non-browser clients, not a permanent block) — but it's a B2B event-CREATION tool (like a Typeform/Eventbrite-alternative for organizers to build their OWN registration page), not a public directory. Nav is Home/About/FAQ/Blog only — no 'Discover' or 'Explore Events' page exists anywhere. There is no browsable list of 'who is using Eventpadi' for any method (extension, scraping API, or otherwise) to find — this is a structural dead end, not a technical one. Recommend dropping entirely rather than pursuing further.",
    listingUrls: ["https://eventpadi.com/"],
  },
  {
    id: "naijaticketshop",
    label: "NaijaTicketShop",
    status: "blocked",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): fails to load even in a real browser (Chrome shows its own error page) — this is genuinely broken infrastructure, not bot-detection. Confirmed dead end regardless of method. Recommend dropping entirely.",
    listingUrls: ["https://naijaticketshop.com/"],
  },
  {
    id: "syticks",
    label: "Syticks",
    status: "unconfirmed",
    researchNote:
      "Real server-rendered homepage (419 words) but no dedicated event-listing page with a direct price/ticket signal was found in this pass. Wired to the generic JSON-LD fallback; needs real selector work to become 'active'.",
    listingUrls: ["https://syticks.com/"],
  },
  {
    id: "obodo",
    label: "Obodo",
    status: "unconfirmed",
    researchNote:
      "Real server-rendered content (1370 words) but the homepage doesn't surface individual priced events directly. Wired to the generic JSON-LD fallback.",
    listingUrls: ["https://www.obo.do/"],
  },
  {
    id: "unboxd",
    label: "Unboxd",
    status: "unconfirmed",
    researchNote:
      "Real content on both homepage and /events, no direct price signal found. Wired to the generic JSON-LD fallback.",
    listingUrls: ["https://unboxd.co/", "https://unboxd.co/events"],
  },
  {
    id: "tiqbuy",
    label: "Tiqbuy",
    status: "unconfirmed",
    researchNote:
      "Real content, no direct price signal found; company may be inactive (founded 2018, described as unfunded in landscape research). Wired to the generic JSON-LD fallback.",
    listingUrls: ["https://www.tiqbuy.com/"],
  },
  {
    id: "tixvnt",
    label: "Tixvnt",
    status: "unconfirmed",
    researchNote:
      "Real content on homepage, intermittent connection issues on deeper paths during research, no direct price signal confirmed. Wired to the generic JSON-LD fallback.",
    listingUrls: ["https://tixvnt.com/"],
  },
];

// Only 'active' configs run in the actual scraper (event-scraper-runner.ts).
export const ACTIVE_EVENT_PLATFORMS: EventPlatformConfig[] = BUILT_CONFIGS.filter(
  (c) => c.status === "active"
);

// 'unconfirmed' platforms still run, but through the generic JSON-LD
// fallback rather than a bespoke parser — see event-scraper-runner.ts.
export const UNCONFIRMED_PLATFORM_IDS = RESEARCHED_NOT_BUILT.filter(
  (p) => p.status === "unconfirmed"
);

// Confirmed (via real-browser research, 2026-07-08) to have real,
// worthwhile event/organizer data behind client-side rendering — these are
// exactly the candidates for extension-based human-assisted capture, NOT
// backend scraping (see conversation decision: extension over Playwright/
// scraping-API, since it's free and can't be blocked). Not run by any
// backend cron — captured only when a team member visits the page with
// the extension installed.
export const EXTENSION_NEEDED_PLATFORMS = RESEARCHED_NOT_BUILT.filter(
  (p) => p.status === "extension_needed"
);

// Platforms with a real product but NO public directory of events/
// organizers to browse at all (verified via real Chrome, 2026-07-08) —
// TixTango and Eventpadi are structural dead ends regardless of method.
// Partyverse is the one exception that still has an automatable fallback:
// it's IG-native, so organizers surface via branded-hashtag posts through
// the existing Apify Instagram hashtag scraper (runIgMentionScan in
// event-scraper-runner.ts). Hashtags are best guesses at what organizers
// actually tag when posting about an event on this platform — worth
// revisiting once real run data shows which tags surface real organizers
// vs. noise. Clooza was removed from this list once real-browser research
// confirmed it has a much better, free, extension-based path instead (see
// EXTENSION_NEEDED_PLATFORMS above).
export const IG_MENTION_PLATFORMS: Array<{
  id: string;
  label: string;
  hashtags: string[];
}> = [
  { id: "partyverse", label: "Partyverse", hashtags: ["partyverse", "partyverseapp"] },
];
