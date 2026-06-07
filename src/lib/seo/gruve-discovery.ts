// Shared vocabulary + URL builder for keyword → Gruve deep-links.
//
// Gruve's events discovery (/home) filters by a time "tab", an event
// category, and a location (city). A keyword like "top raves in Lagos"
// maps to { when: null, category: "music" (closest to raves), location:
// "Lagos" } → /home?category=music&location=Lagos. "weekend events near
// me" → { when: "weekend" } → /home?when=weekend.
//
// Pure + isomorphic (no server-only) so the keywords UI and the AI mapper
// both use it. The AI mapper does the smart closest-category match; this
// heuristic is the offline / fallback baseline.

export const GRUVE_CATEGORIES = [
  "business", "religious", "comedy", "tech", "food_drinks", "crypto",
  "education", "healthcare", "sports_fitness", "music", "seminars",
  "visual_art", "community", "fashion", "media", "travel", "politics",
  "home", "school", "charity_fund",
] as const;
export type GruveCategory = (typeof GRUVE_CATEGORIES)[number];

// Mirrors the time tabs in Gruve's useGetHome (All/Today/Weekend/TGIF/free).
export const GRUVE_WHEN = ["all", "today", "weekend", "tgif", "free"] as const;
export type GruveWhen = (typeof GRUVE_WHEN)[number];

export const GRUVE_HOSTS = {
  live: "https://www.gruve.events",
  gamma: "https://gamma.gruve.events",
} as const;

export interface GruveDiscoveryFilters {
  location: string | null;
  category: GruveCategory | null;
  when: GruveWhen | null;
}

/**
 * Build the Gruve deep-link that opens discovery with the filters applied.
 * Routes to the existing surfaces: a category → /categories/<cat> (Gruve's
 * category landing), otherwise the /home listing. location + time tab ride
 * along as query params on either.
 *   "top raves in Lagos"        → /categories/music?location=Lagos
 *   "weekend events near me"     → /home?when=weekend
 *   "comedy this weekend Abuja"  → /categories/comedy?location=Abuja&when=weekend
 */
export function buildGruveDiscoveryUrl(
  f: GruveDiscoveryFilters,
  host: string = GRUVE_HOSTS.live
): string {
  const p = new URLSearchParams();
  if (f.location) p.set("location", f.location);
  if (f.when && f.when !== "all") p.set("when", f.when);
  const qs = p.toString();
  const suffix = qs ? `?${qs}` : "";
  if (f.category) return `${host}/categories/${f.category}${suffix}`;
  return `${host}/home${suffix}`;
}

export function isGruveCategory(v: string | null | undefined): v is GruveCategory {
  return !!v && (GRUVE_CATEGORIES as readonly string[]).includes(v);
}

// Keyword tokens → closest Gruve category (for the deterministic fallback).
const CATEGORY_SYNONYMS: Record<string, GruveCategory> = {
  rave: "music", raves: "music", party: "music", parties: "music", concert: "music",
  concerts: "music", dj: "music", gig: "music", festival: "music", afrobeats: "music",
  amapiano: "music", nightlife: "music", club: "music",
  comedy: "comedy", standup: "comedy", "stand-up": "comedy",
  tech: "tech", startup: "tech", startups: "tech", hackathon: "tech", ai: "tech",
  crypto: "crypto", web3: "crypto", blockchain: "crypto", nft: "crypto",
  food: "food_drinks", foods: "food_drinks", drink: "food_drinks", drinks: "food_drinks",
  dining: "food_drinks", brunch: "food_drinks", wine: "food_drinks", restaurant: "food_drinks",
  fashion: "fashion", runway: "fashion", style: "fashion",
  sport: "sports_fitness", sports: "sports_fitness", fitness: "sports_fitness",
  gym: "sports_fitness", marathon: "sports_fitness", football: "sports_fitness",
  business: "business", networking: "business", expo: "business",
  conference: "seminars", seminar: "seminars", summit: "seminars",
  workshop: "education", class: "education", classes: "education", course: "education",
  bootcamp: "education", training: "education",
  church: "religious", worship: "religious", gospel: "religious", crusade: "religious",
  art: "visual_art", arts: "visual_art", exhibition: "visual_art", gallery: "visual_art",
  travel: "travel", tour: "travel", getaway: "travel",
  community: "community", meetup: "community",
  health: "healthcare", wellness: "healthcare", medical: "healthcare",
  politics: "politics", charity: "charity_fund", fundraiser: "charity_fund",
  school: "school", graduation: "school",
  media: "media", podcast: "media", film: "media", movie: "media",
};

const KNOWN_CITIES = [
  "lagos", "abuja", "ibadan", "port harcourt", "kano", "benin", "enugu",
  "kaduna", "jos", "uyo", "calabar", "owerri", "accra", "nairobi", "london",
];

/** Deterministic keyword → filters. No AI. Used as fallback + offline. */
export function heuristicMap(keyword: string): GruveDiscoveryFilters {
  const k = keyword.toLowerCase();

  let when: GruveWhen | null = null;
  if (/\bweekend\b/.test(k)) when = "weekend";
  else if (/\b(tonight|today)\b/.test(k)) when = "today";
  else if (/\b(tgif|friday)\b/.test(k)) when = "tgif";
  else if (/\bfree\b/.test(k)) when = "free";

  let category: GruveCategory | null = null;
  for (const [token, cat] of Object.entries(CATEGORY_SYNONYMS)) {
    if (new RegExp(`\\b${token}\\b`).test(k)) {
      category = cat;
      break;
    }
  }

  // "near me / near you / here" = geolocation, not a city.
  const NON_LOCATIONS = new Set(["me", "you", "us", "here", "my area", "near me"]);

  let location: string | null = null;
  // "in/near/at <city>" — prefer an explicit preposition.
  const m = k.match(/\b(?:in|near|at|around)\s+([a-z][a-z\s]+?)(?:$|[,.])/);
  let cand = m?.[1]?.trim();
  if (cand) {
    // Drop trailing time words that bleed into the capture ("you today").
    cand = cand.replace(/\b(today|tonight|tomorrow|this|weekend|tgif|now)\b/g, "").trim();
  }
  const candIsPronoun = !!cand && /^(me|you|us|here|my)\b/.test(cand);
  if (cand && !NON_LOCATIONS.has(cand) && !candIsPronoun) {
    location = cand
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } else if (!cand) {
    for (const city of KNOWN_CITIES) {
      if (new RegExp(`\\b${city}\\b`).test(k)) {
        location = city
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        break;
      }
    }
  }

  return { location, category, when };
}
