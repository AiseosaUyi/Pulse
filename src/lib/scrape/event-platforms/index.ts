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
    id: "clooza",
    label: "Clooza",
    status: "extension_needed",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): genuinely real, rich web app once past the client-render — an 'Explore' feed with real events (title, organizer name + handle, engagement), and organizer PROFILE pages at a predictable clooza.com/<handle> URL with display name, bio, an external link (often Linktree — a strong secondary social-handle signal), and follower count. curl confirms this data is 100% client-fetched (16 words of real text vs. the full profile seen in a real browser) — genuinely needs a real browser, which is exactly what extension-based capture provides. Best candidate for the extension build alongside Tickethub.ng and Eventpadi.",
    listingUrls: ["https://clooza.com/events"],
  },
  {
    id: "eventporte",
    label: "EventPorte",
    status: "extension_needed",
    researchNote:
      "Added 2026-07-08 (user-suggested). VERIFIED via real Chrome: real 'Discover Events' feed at /discovery with priced events (e.g. 'Sunday Service' — From ₦3,000.00, venue, date). Event detail pages show the organizer directly ('Sunday Service WITH DEJI' + a clickable 'Visit Profile' link) — no login required, publicly viewable. curl confirms client-rendered (86 real words vs. full content in a real browser) — same category as Clooza/Tickethub/Eventpadi.",
    listingUrls: ["https://www.eventporte.com/discovery"],
  },
  {
    id: "selar",
    label: "Selar",
    status: "extension_needed",
    researchNote:
      "627KB page, ~10 words of real text — fully client-rendered SPA (not re-verified live, but same signature as Clooza/Tickethub before verification). Not IG-native the way Clooza was — a real-browser check (same as Clooza) would likely confirm this is extension-buildable too; not yet prioritized.",
    listingUrls: ["https://selar.co/"],
  },
  {
    id: "tickethub",
    label: "Tickethub.ng",
    status: "extension_needed",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): excellent real data once rendered — /discover shows real priced events (category, price, date, venue), and event detail pages show the organizer's real name directly ('by Justina Okafor'), not just a handle. curl only ever sees loading-shimmer skeletons (confirmed: 0 words of real content), so this absolutely needs a real browser. No login required — publicly viewable once rendered.",
    listingUrls: ["https://tickethub.ng/discover"],
  },
  {
    id: "eventpadi",
    label: "Eventpadi",
    status: "extension_needed",
    researchNote:
      "CORRECTED (2026-07-08, user-directed): the public marketing site (eventpadi.com) has no discover page and was wrongly marked a dead end. The REAL product is at app.eventpadi.com/dashboard/discover/events — a genuine 'Explore Events' feed with direct 'Organized by: <name>' links, prices, dates, categories. Confirmed via real Chrome while logged in. Caveat: this page requires an authenticated Eventpadi account/session — whoever installs the capture extension needs to be signed in to Eventpadi first (a human step, not something Pulse can automate; account creation is out of scope for Claude to do on the user's behalf).",
    listingUrls: ["https://app.eventpadi.com/dashboard/discover/events"],
  },
  {
    id: "tixvnt",
    label: "Tixvnt",
    status: "extension_needed",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): real 'Events' feed at /events with priced events (title, location, price, date) — curl only sees 311 words of real text (no real titles), confirmed client-rendered. Event detail pages show the organizer directly ('Organized by: TedxUniAbuja'), plus real ticket tiers/prices. Same category as Clooza/Tickethub/Eventpadi/EventPorte.",
    listingUrls: ["https://tixvnt.com/events"],
  },
  {
    id: "ariiyatickets",
    label: "Ariiya Tickets",
    status: "unconfirmed",
    researchNote:
      "Added 2026-07-08 (user-suggested). Homepage is real and server-rendered (2,133 words via curl) with a genuine Featured Events carousel. BUT: every individual event/category page tested 404s — both /events/, /event/<real-slug>/ copied directly from the homepage's own links, AND clicking the link in a real browser (which just anchor-scrolls to the carousel instead of navigating). This looks like a live bug/instability on Ariiya's own site right now, not a rendering or anti-bot problem. Worth a second look later — not a clean win today.",
    listingUrls: ["https://www.ariiyatickets.com/"],
  },
  {
    id: "syticks",
    label: "Syticks",
    status: "no_public_directory",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): nav has Home/Community/About/Blog/Products — no discover/explore page exists. 'Community' just redirects to a WhatsApp group invite link (chat.whatsapp.com), not an events feed. No public directory to scrape by any method. Corrected from an earlier 'unconfirmed' read.",
    listingUrls: ["https://syticks.com/"],
  },
  {
    id: "obodo",
    label: "Obodo",
    status: "no_public_directory",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): a B2B event-creation/community tool (like Eventpadi's marketing site) — /product/events is a feature-description page, not a listing. /discover redirects straight back to the homepage; no such page exists. No public directory found. Corrected from an earlier 'unconfirmed' read.",
    listingUrls: ["https://www.obo.do/"],
  },
  {
    id: "unboxd",
    label: "Unboxd",
    status: "no_public_directory",
    researchNote:
      "VERIFIED via real Chrome (2026-07-08): pure B2B sign-up/demo funnel (Features / Contact Sales / Log In / Sign Up only, app.unboxd.co is their private dashboard). No public event directory exists anywhere on the marketing site. Corrected from an earlier 'unconfirmed' read.",
    listingUrls: ["https://unboxd.co/"],
  },
  {
    id: "tiqbuy",
    label: "Tiqbuy",
    status: "no_public_directory",
    researchNote:
      "VERIFIED (2026-07-08): tiqbuy.com now redirects to a HugeDomains \"this domain is for sale — $995\" parking page. The company is confirmed inactive/dead, not just under-researched — matches the earlier landscape-research note that it was founded 2018 and unfunded. Drop entirely.",
    listingUrls: [],
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

// TixTango and Partyverse were dropped entirely (2026-07-08, user-directed)
// once real-browser research confirmed both are mobile-app-only — no web
// presence exists for either (event cards on their marketing sites are
// static images, not real UI; confirmed via accessibility tree). No
// scraping method (extension, Playwright, scraping API) can reach a native
// app, and no automatable fallback (e.g. IG-hashtag monitoring) was kept
// for either. NaijaTicketShop was also dropped — fails to load even in a
// real Chrome browser, genuinely broken infrastructure.
//
// This array is currently empty: Clooza (the one platform that used to be
// here) moved to EXTENSION_NEEDED_PLATFORMS once real-browser research
// found it has a much better, free, extension-based path instead. Kept as
// an empty, documented export rather than deleted so a future platform
// that turns out to be IG-native-with-no-website has an obvious place to
// go — see runIgMentionScan in event-scraper-runner.ts.
export const IG_MENTION_PLATFORMS: Array<{
  id: string;
  label: string;
  hashtags: string[];
}> = [];
