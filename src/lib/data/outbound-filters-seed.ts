// Seed values for the tenant-editable outbound filter set. Everything
// below can be edited in /settings/outbound-filters.
//
// Keywords are event-intent signals the qualifier looks for in the
// captured prospect's bio, post caption, or comment. Competitor URLs
// are ticketing/event platforms — if a prospect links to one, they're
// running events on a rival and become a poach target.
//
// GRUVE_EXAMPLE_* below are Gruve's own filter values, kept here only as
// worked examples / placeholder text for the settings UI. They must NOT be
// used as the cross-tenant default — a tenant with no saved filters gets
// EMPTY filters (see DEFAULT_OUTBOUND_FILTERS_SEED) plus an explicit setup
// prompt, not another tenant's ICP. (Root-caused: sippy inherited Gruve's
// event-ticketing keywords/competitors/all-37-states geo scope purely
// because this file's default used to double as the fallback for every
// tenant.)

export const GRUVE_EXAMPLE_EVENT_KEYWORDS: string[] = [
  "conference", "wedding", "engaged", "party", "rave", "beach party",
  "birthday", "proposal", "save the date", "bachelorette", "bachelor party",
  "gala", "album launch", "anniversary", "reception", "engagement shoot",
  "wedding planner", "bridesmaid", "groomsmen", "asoebi",
  "traditional wedding", "white wedding", "introduction", "album release",
  "listening party", "book launch", "fashion show", "showcase",
  "launch event", "pop-up", "popup", "yacht party", "dinner party",
  "detty december", "owambe", "housewarming", "graduation", "baby shower",
  "gender reveal", "christening", "naming ceremony", "funeral", "memorial",
  "festival", "concert", "gig", "meetup", "summit", "retreat", "brunch",
  "day party",
];

export const GRUVE_EXAMPLE_COMPETITOR_URLS: string[] = [
  "tix.africa",
  "eventbrite.com",
  "luma.com",
  "partiful.com",
  "opentable.com",
  "nairaevents.com",
  "naijaticketshop.com",
  "etickets.ng",
  "passforward.com",
  "dice.fm",
  "posh.vip",
];

export const DEFAULT_PASSIVE_ENABLED = true;
export const DEFAULT_DWELL_MS = 1200;

// The actual cross-tenant default: empty. A new (or never-configured)
// tenant should see an explicit "set up your filters" prompt in
// /settings/outbound-filters, not silently inherit another brand's ICP.
export const DEFAULT_OUTBOUND_FILTERS_SEED = {
  keywords: [] as string[],
  geoScope: [] as import("./geo-seed").GeoRegion[],
  competitorUrls: [] as string[],
  passiveCaptureEnabled: DEFAULT_PASSIVE_ENABLED,
  dwellMs: DEFAULT_DWELL_MS,
};
