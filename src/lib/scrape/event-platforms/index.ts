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
    status: "needs_browser",
    researchNote:
      "Homepage is a mobile-app marketing shell only ('Preparing your event discovery experience...' loading placeholder) — no event listings are server-rendered on the public web at all, and no public API host is discoverable in the shipped JS chunks (Next.js app — data likely fetched client-side). PENDING: will be wired up via a scraping-API rendered-fetch (see scraping-api.ts) once a real rendered page can be inspected and a proper parser written — not yet built.",
    listingUrls: ["https://tixtango.com/"],
  },
  {
    id: "clooza",
    label: "Clooza",
    status: "needs_browser",
    researchNote:
      "162KB page, ~21 words of real text after stripping scripts — a client-rendered SPA shell, no public API discoverable. NOT going through Playwright/scraping-API — Clooza is IG-native, so organizers surface via branded-hashtag posts instead. See IG_MENTION_PLATFORMS below (event-scraper-runner.ts runIgMentionScan) — uses the existing Apify Instagram hashtag scraper, already paid for.",
    listingUrls: ["https://clooza.com/events"],
  },
  {
    id: "partyverse",
    label: "Partyverse",
    status: "needs_browser",
    researchNote:
      "404KB page, mostly JS bundle bloat with low real-text ratio on the /guests discovery page — client-rendered, no public API discoverable. Same as Clooza: handled via IG_MENTION_PLATFORMS below instead of a web scraper.",
    listingUrls: ["https://www.partyverse.com/guests"],
  },
  {
    id: "selar",
    label: "Selar",
    status: "needs_browser",
    researchNote:
      "627KB page, ~10 words of real text — fully client-rendered SPA. Not IG-native the way Clooza/Partyverse are (Selar is a broader digital-products platform, tickets are one feature) — deferred rather than routed to IG scan.",
    listingUrls: ["https://selar.co/"],
  },
  {
    id: "tickethub",
    label: "Tickethub.ng",
    status: "needs_browser",
    researchNote:
      "Homepage HTML ships 30 repeated loading-shimmer skeleton divs with no real event data — Next.js app, content loads client-side after initial paint, no public API host discoverable in shipped JS chunk filenames. PENDING: scraping-API rendered-fetch once available — see scraping-api.ts.",
    listingUrls: ["https://tickethub.ng/"],
  },
  {
    id: "eventpadi",
    label: "Eventpadi",
    status: "blocked",
    researchNote:
      "TLS handshake reset (curl error 35/56) on every attempt — anti-bot/WAF blocking non-browser TLS fingerprints at the network layer, before HTTP even starts. A real browser's TLS stack fixes this — PENDING: scraping-API rendered-fetch (ScraperAPI presents a real browser TLS fingerprint) — see scraping-api.ts.",
    listingUrls: ["https://eventpadi.com/"],
  },
  {
    id: "naijaticketshop",
    label: "NaijaTicketShop",
    status: "blocked",
    researchNote:
      "Self-signed/broken TLS cert, an HTTP→HTTPS→HTTP redirect loop, and a 403 on the plain-HTTP fallback — broken infra plus active bot-blocking. Low-quality target even if reachable; worth an opportunistic retry through the scraping API once wired, but not a priority build.",
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

// Clooza and Partyverse are IG-native brands with no scrapable website
// (see researchNote above) — organizers surface via branded-hashtag posts
// instead, through the existing Apify Instagram hashtag scraper
// (runIgMentionScan in event-scraper-runner.ts). Hashtags are best guesses
// at what organizers actually tag when posting about an event on these
// platforms — worth revisiting once real run data shows which tags surface
// real organizers vs. noise.
export const IG_MENTION_PLATFORMS: Array<{
  id: string;
  label: string;
  hashtags: string[];
}> = [
  { id: "clooza", label: "Clooza", hashtags: ["clooza", "cloozaevents"] },
  { id: "partyverse", label: "Partyverse", hashtags: ["partyverse", "partyverseapp"] },
];
