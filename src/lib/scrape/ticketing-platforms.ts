// Configs for each ticketing platform scraped by the lead-gen cron.
// Each platform maps to an Apify actor + input builder + item parser.
// The parsers are defensive: if a field is missing, the candidate is
// either null-fielded or dropped entirely.

export type PlatformId = "jetron" | "eventbrite" | "luma" | "tix_africa";

export interface OrganizerCandidate {
  platformId: PlatformId;
  organizerName: string;
  igHandle: string | null;    // Extracted directly from page links / bio
  organizerUrl: string | null;
  eventTitle: string;
  eventDate: string;          // YYYY-MM-DD
  eventUrl: string;
}

export interface PlatformConfig {
  id: PlatformId;
  label: string;
  actorId: string;
  buildInput: (opts: { limitPerRun: number }) => unknown;
  parseItem: (item: unknown) => OrganizerCandidate | null;
}

// IG link regex — skips well-known non-profile path segments
const IG_LINK_RE = /instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/i;
const IG_SKIP = new Set([
  "p", "reel", "reels", "explore", "stories", "tv", "ar",
  "accounts", "about", "privacy", "legal", "help",
]);

export function extractIgHandle(text: string): string | null {
  const m = IG_LINK_RE.exec(text);
  if (!m) return null;
  const handle = m[1].toLowerCase();
  return IG_SKIP.has(handle) ? null : handle;
}

export function toIsoDate(raw: string | undefined | null): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// website-content-crawler returns: { url, title, text, html }
// Eventbrite / structured scrapers may return nested event objects.

export const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    id: "jetron",
    label: "Jetron",
    actorId: process.env.APIFY_WCC_ACTOR_ID || "apify~website-content-crawler",
    buildInput: ({ limitPerRun }) => ({
      startUrls: [{ url: "https://jetron.ng/events" }],
      maxCrawlPages: limitPerRun,
      crawlerType: "cheerio",
      includeUrlGlobs: [
        "https://jetron.ng/events/*",
        "https://jetron.ng/e/*",
      ],
    }),
    parseItem: (item) => {
      const i = item as Record<string, unknown>;
      const url = str(i.url);
      if (!url.includes("jetron.ng")) return null;
      const html = str(i.html) + " " + str(i.text);
      if (!html.trim()) return null;
      const igHandle = extractIgHandle(html);
      const text = str(i.text);
      const orgMatch = text.match(/(?:organized|hosted|presented) by[:\s]+([^\n,]{2,60})/i);
      const orgName = str(i.organizerName) || orgMatch?.[1]?.trim() || "Unknown Organizer";
      return {
        platformId: "jetron",
        organizerName: orgName.slice(0, 120),
        igHandle,
        organizerUrl: null,
        eventTitle: (str(i.title) || str(i.pageTitle)).slice(0, 200),
        eventDate: toIsoDate(str(i.startDate) || str(i.date) || null),
        eventUrl: url,
      };
    },
  },

  {
    id: "eventbrite",
    label: "Eventbrite",
    actorId: process.env.APIFY_EVENTBRITE_ACTOR_ID || "apify~website-content-crawler",
    buildInput: ({ limitPerRun }) => ({
      startUrls: [
        { url: "https://www.eventbrite.com/d/nigeria/events/" },
        { url: "https://www.eventbrite.com/d/nigeria--lagos/events/" },
        { url: "https://www.eventbrite.com/d/nigeria--abuja/events/" },
      ],
      maxCrawlPages: limitPerRun,
      crawlerType: "cheerio",
      includeUrlGlobs: ["https://www.eventbrite.com/e/*"],
    }),
    parseItem: (item) => {
      const i = item as Record<string, unknown>;
      const url = str(i.url);
      if (!url.includes("eventbrite.com/e/")) return null;
      const html = str(i.html) + " " + str(i.text);
      const igHandle = extractIgHandle(html);
      const organizer = (i.organizer as Record<string, unknown> | undefined) ?? {};
      const orgName = str(organizer.name) || str(i.organizerName) || "Unknown Organizer";
      const orgUrl = str(organizer.url) || str(i.organizerUrl) || null;
      return {
        platformId: "eventbrite",
        organizerName: orgName.slice(0, 120),
        igHandle,
        organizerUrl: orgUrl || null,
        eventTitle: (str(i.name) || str(i.title)).slice(0, 200),
        eventDate: toIsoDate(str(i.startDate) || str(i.date) || null),
        eventUrl: url,
      };
    },
  },

  {
    id: "luma",
    label: "Luma",
    actorId: process.env.APIFY_WCC_ACTOR_ID || "apify~website-content-crawler",
    buildInput: ({ limitPerRun }) => ({
      startUrls: [
        { url: "https://lu.ma/discover?location=lagos" },
        { url: "https://lu.ma/discover?location=nigeria" },
        { url: "https://lu.ma/discover?location=abuja" },
      ],
      maxCrawlPages: limitPerRun,
      crawlerType: "cheerio",
      includeUrlGlobs: ["https://lu.ma/*"],
      excludeUrlGlobs: ["https://lu.ma/discover*", "https://lu.ma/user/*"],
    }),
    parseItem: (item) => {
      const i = item as Record<string, unknown>;
      const url = str(i.url);
      if (!url.startsWith("https://lu.ma/") || url.includes("/discover")) return null;
      const html = str(i.html) + " " + str(i.text);
      const igHandle = extractIgHandle(html);
      const text = str(i.text);
      const hostMatch = text.match(/(?:hosted by|host)[:\s]+([^\n,]{2,60})/i);
      const orgName = str(i.organizerName) || hostMatch?.[1]?.trim() || "Unknown Organizer";
      return {
        platformId: "luma",
        organizerName: orgName.slice(0, 120),
        igHandle,
        organizerUrl: null,
        eventTitle: (str(i.title) || str(i.pageTitle)).slice(0, 200),
        eventDate: toIsoDate(str(i.startDate) || str(i.date) || null),
        eventUrl: url,
      };
    },
  },

  {
    id: "tix_africa",
    label: "Tix.africa",
    actorId: process.env.APIFY_WCC_ACTOR_ID || "apify~website-content-crawler",
    buildInput: ({ limitPerRun }) => ({
      startUrls: [{ url: "https://tix.africa" }],
      maxCrawlPages: limitPerRun,
      crawlerType: "cheerio",
      includeUrlGlobs: ["https://tix.africa/*"],
      excludeUrlGlobs: ["https://tix.africa/blog/*", "https://tix.africa/about*"],
    }),
    parseItem: (item) => {
      const i = item as Record<string, unknown>;
      const url = str(i.url);
      if (!url.includes("tix.africa")) return null;
      const html = str(i.html) + " " + str(i.text);
      if (!html.trim()) return null;
      const igHandle = extractIgHandle(html);
      const text = str(i.text);
      const orgMatch = text.match(/(?:organized|hosted) by[:\s]+([^\n,]{2,60})/i);
      const orgName = str(i.organizerName) || orgMatch?.[1]?.trim() || "Unknown Organizer";
      return {
        platformId: "tix_africa",
        organizerName: orgName.slice(0, 120),
        igHandle,
        organizerUrl: null,
        eventTitle: (str(i.title) || str(i.pageTitle)).slice(0, 200),
        eventDate: toIsoDate(str(i.startDate) || str(i.date) || null),
        eventUrl: url,
      };
    },
  },
];
