// Orchestrates the three-step ticketing platform lead-gen pipeline:
//   1. Scrape all configured platforms via Apify actors
//   2. Aggregate candidates by IG handle + compute cadence counts
//   3. Enrich found handles with IG profile data (bio, followers, avatar)

import { runActorSync } from "@/lib/scrape/apify-rest";
import {
  PLATFORM_CONFIGS,
  type OrganizerCandidate,
  type PlatformId,
} from "@/lib/scrape/ticketing-platforms";

export interface PlatformSource {
  platform: PlatformId;
  eventTitle: string;
  eventDate: string;
  eventUrl: string;
}

export interface EnrichedOrganizer {
  igHandle: string;
  igDisplayName: string | null;
  igBio: string | null;
  igFollowerCount: number | null;
  igProfileUrl: string;
  igAvatarUrl: string | null;
  platformSources: PlatformSource[];
  events90d: number;
  events365d: number;
  lastEventDate: string;
}

const MS_90D = 90 * 24 * 60 * 60 * 1000;
const MS_365D = 365 * 24 * 60 * 60 * 1000;

export async function scrapeAllPlatforms(opts: {
  limitPerPlatform: number;
}): Promise<OrganizerCandidate[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.warn("[ticketing-scraper] APIFY_API_TOKEN not set — skipping scrape");
    return [];
  }

  const jobs = PLATFORM_CONFIGS.map(async (cfg) => {
    try {
      const items = await runActorSync<unknown>({
        token,
        actorId: cfg.actorId,
        input: cfg.buildInput({ limitPerRun: opts.limitPerPlatform }),
        timeout: 120,
        memory: 512,
      });
      return items
        .map(cfg.parseItem)
        .filter((c): c is OrganizerCandidate => c !== null && !!c.eventTitle && !!c.eventUrl);
    } catch (err) {
      console.error(`[ticketing-scraper] ${cfg.label} scrape failed`, err);
      return [] as OrganizerCandidate[];
    }
  });

  const results = await Promise.all(jobs);
  return results.flat();
}

// Group by IG handle. Candidates without a handle are silently dropped —
// we can't upsert to prospects without a unique identifier.
export function aggregateCandidates(
  candidates: OrganizerCandidate[]
): Map<string, EnrichedOrganizer> {
  const now = Date.now();
  const map = new Map<string, EnrichedOrganizer>();

  for (const c of candidates) {
    if (!c.igHandle) continue;
    const handle = c.igHandle.toLowerCase();
    const eventTs = new Date(c.eventDate).getTime();
    const source: PlatformSource = {
      platform: c.platformId,
      eventTitle: c.eventTitle,
      eventDate: c.eventDate,
      eventUrl: c.eventUrl,
    };

    const existing = map.get(handle);
    if (!existing) {
      map.set(handle, {
        igHandle: handle,
        igDisplayName: null,
        igBio: null,
        igFollowerCount: null,
        igProfileUrl: `https://www.instagram.com/${handle}/`,
        igAvatarUrl: null,
        platformSources: [source],
        events90d: now - eventTs <= MS_90D ? 1 : 0,
        events365d: now - eventTs <= MS_365D ? 1 : 0,
        lastEventDate: c.eventDate,
      });
    } else {
      existing.platformSources.push(source);
      if (now - eventTs <= MS_90D) existing.events90d += 1;
      if (now - eventTs <= MS_365D) existing.events365d += 1;
      if (new Date(c.eventDate) > new Date(existing.lastEventDate)) {
        existing.lastEventDate = c.eventDate;
      }
    }
  }

  return map;
}

interface IgProfileItem {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  profilePicUrl?: string;
}

// Enrich a list of known IG handles with profile data.
// Runs in batches of 25 to keep actor invocation times short.
// Silently skips handles where Apify returns nothing.
export async function enrichHandlesWithIg(
  handles: string[]
): Promise<Map<string, IgProfileItem>> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId =
    process.env.APIFY_IG_PROFILE_ACTOR_ID ?? "apify/instagram-profile-scraper";
  const out = new Map<string, IgProfileItem>();

  if (!token || handles.length === 0) return out;

  const BATCH = 25;
  for (let i = 0; i < handles.length; i += BATCH) {
    const chunk = handles.slice(i, i + BATCH);
    try {
      const items = await runActorSync<IgProfileItem>({
        token,
        actorId,
        input: {
          directUrls: chunk.map((h) => `https://www.instagram.com/${h}/`),
          resultsType: "details",
          resultsLimit: chunk.length,
        },
        timeout: 90,
        memory: 512,
      });
      for (const item of items) {
        if (item.username) out.set(item.username.toLowerCase(), item);
      }
    } catch (err) {
      console.error("[ticketing-scraper] IG enrich batch failed", err);
    }
  }
  return out;
}
