// Shared types for the self-hosted event-platform scraper. Parallel to
// PlatformConfig in ticketing-platforms.ts, but that abstraction is 100%
// coupled to Apify (actorId + buildInput); this one fetches HTML directly
// (see event-fetch.ts) and parses it with cheerio — no Apify involved.

export interface EventCandidate {
  platformId: string;
  eventTitle: string;
  eventUrl: string;
  eventDate: string; // ISO date (YYYY-MM-DD); today's date if unknown
  priceRaw: string | null; // e.g. "₦5,000.00" — as shown on the page
  isPaid: boolean; // qualifying signal: false = free/RSVP-only, excluded downstream
  organizerName: string | null;
  category: string | null;
}

export type EventPlatformStatus =
  | "active" // confirmed real server-rendered listing with price signal — safe to crawl
  | "extension_needed" // confirmed real web app with real event/organizer data, but client-rendered — needs a real browser (extension capture), not backend-scrapable
  | "no_public_directory" // has a real product (web or app) but no browsable public feed of events/organizers exists at all — not fixable by any scraping method
  | "blocked" // anti-bot / broken TLS or infra at the network level — unreachable via plain fetch, confirmed unreachable even via a real browser
  | "unconfirmed"; // real page content exists but no listing page with a direct price signal was found

export interface EventPlatformConfig {
  id: string;
  label: string;
  status: EventPlatformStatus;
  /** One research note per platform — why it's active/needs_browser/blocked/unconfirmed. */
  researchNote: string;
  listingUrls: string[];
  parseListing: (html: string, sourceUrl: string) => EventCandidate[];
  /** Optional: fetch the event detail page to resolve organizer name. */
  resolveOrganizer?: (candidate: EventCandidate) => Promise<string | null>;
}
