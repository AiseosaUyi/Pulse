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
      "Homepage is a mobile-app marketing shell only ('Preparing your event discovery experience...' loading placeholder) — no event listings are server-rendered on the public web at all. This is an app-first platform (TikTok-style feed), not a scrapable website.",
    listingUrls: ["https://tixtango.com/"],
  },
  {
    id: "clooza",
    label: "Clooza",
    status: "needs_browser",
    researchNote:
      "162KB page, ~21 words of real text after stripping scripts — a client-rendered SPA shell. Would need Playwright, which the cost constraint (no proxy/Playwright spend without evidence it's needed) rules out for this pass.",
    listingUrls: ["https://clooza.com/events"],
  },
  {
    id: "partyverse",
    label: "Partyverse",
    status: "needs_browser",
    researchNote:
      "404KB page, mostly JS bundle bloat with low real-text ratio on the /guests discovery page — client-rendered. Same Playwright/cost tradeoff as Clooza.",
    listingUrls: ["https://www.partyverse.com/guests"],
  },
  {
    id: "selar",
    label: "Selar",
    status: "needs_browser",
    researchNote:
      "627KB page, ~10 words of real text — fully client-rendered SPA. Same Playwright/cost tradeoff.",
    listingUrls: ["https://selar.co/"],
  },
  {
    id: "tickethub",
    label: "Tickethub.ng",
    status: "needs_browser",
    researchNote:
      "Homepage HTML ships 30 repeated loading-shimmer skeleton divs with no real event data — content loads client-side after initial paint despite looking promising on first signal-count pass. Corrected from an earlier, wrong 'good candidate' read.",
    listingUrls: ["https://tickethub.ng/"],
  },
  {
    id: "eventpadi",
    label: "Eventpadi",
    status: "blocked",
    researchNote:
      "TLS handshake reset (curl error 35/56) on every attempt — anti-bot/WAF blocking non-browser TLS fingerprints at the network layer, before HTTP even starts. Unreachable via plain fetch; would need a real browser's TLS stack.",
    listingUrls: ["https://eventpadi.com/"],
  },
  {
    id: "naijaticketshop",
    label: "NaijaTicketShop",
    status: "blocked",
    researchNote:
      "Self-signed/broken TLS cert, an HTTP→HTTPS→HTTP redirect loop, and a 403 on the plain-HTTP fallback — broken infra plus active bot-blocking. Low-quality target even if reachable.",
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
