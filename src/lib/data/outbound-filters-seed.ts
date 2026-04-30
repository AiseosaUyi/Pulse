// Seed values for the tenant-editable outbound filter set. Everything
// below can be edited in /settings/outbound-filters.
//
// Keywords are event-intent signals the qualifier looks for in the
// captured prospect's bio, post caption, or comment. Competitor URLs
// are ticketing/event platforms — if a prospect links to one, they're
// running events on a rival and become a poach target.

import { DEFAULT_GEO_SCOPE } from "./geo-seed";

export const DEFAULT_EVENT_KEYWORDS: string[] = [
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

export const DEFAULT_COMPETITOR_URLS: string[] = [
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

export const DEFAULT_OUTBOUND_FILTERS_SEED = {
  keywords: DEFAULT_EVENT_KEYWORDS,
  geoScope: DEFAULT_GEO_SCOPE,
  competitorUrls: DEFAULT_COMPETITOR_URLS,
  passiveCaptureEnabled: DEFAULT_PASSIVE_ENABLED,
  dwellMs: DEFAULT_DWELL_MS,
};
