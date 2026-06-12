// Generic platform-discovery crawler. Runs a tenant's configured discovery
// sources through Apify's website-content-crawler, extracts Instagram handles
// from the crawled pages, aggregates by handle, and scores by listing activity.
// Vertical-agnostic: ticketing sites, drinks platforms, anything with public
// pages that link an IG handle. Reuses the IG profile enrichment from the
// ticketing pipeline.

import { runActorSync } from "@/lib/scrape/apify-rest";
import {
  extractIgHandle,
  toIsoDate,
  str,
} from "@/lib/scrape/ticketing-platforms";
import { enrichHandlesWithIg } from "@/lib/scrape/ticketing-scraper";
import type { DiscoverySource } from "@/lib/scrape/discovery-config";

export interface DiscoveryCandidate {
  sourceId: string;
  igHandle: string;
  title: string;
  date: string; // YYYY-MM-DD (defaults to today when the page has none)
  url: string;
}

export interface AggregatedHandle {
  igHandle: string;
  igProfileUrl: string;
  displayName: string | null;
  bio: string | null;
  followerCount: number | null;
  avatarUrl: string | null;
  sources: Array<{ sourceId: string; title: string; date: string; url: string }>;
  count90d: number;
  count365d: number;
  lastDate: string;
}

const MS_90D = 90 * 24 * 60 * 60 * 1000;
const MS_365D = 365 * 24 * 60 * 60 * 1000;

export async function crawlSources(
  sources: DiscoverySource[],
  limitPerSource: number
): Promise<DiscoveryCandidate[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.warn("[platform-discovery] APIFY_API_TOKEN not set — skipping");
    return [];
  }
  const actorId =
    process.env.APIFY_WCC_ACTOR_ID ?? "apify/website-content-crawler";

  const jobs = sources.map(async (src) => {
    try {
      const items = await runActorSync<Record<string, unknown>>({
        token,
        actorId,
        input: {
          startUrls: src.startUrls.map((url) => ({ url })),
          maxCrawlPages: limitPerSource,
          crawlerType: "cheerio",
          includeUrlGlobs: src.includeUrlGlobs,
          ...(src.excludeUrlGlobs ? { excludeUrlGlobs: src.excludeUrlGlobs } : {}),
        },
        timeout: 120,
        memory: 512,
      });

      const out: DiscoveryCandidate[] = [];
      for (const i of items) {
        const url = str(i.url);
        if (!url) continue;
        const html = str(i.html) + " " + str(i.text);
        if (!html.trim()) continue;
        const igHandle = extractIgHandle(html);
        if (!igHandle) continue;
        out.push({
          sourceId: src.id,
          igHandle,
          title: (str(i.title) || str(i.pageTitle) || str(i.name)).slice(0, 200),
          date: toIsoDate(str(i.startDate) || str(i.date) || null),
          url,
        });
      }
      return out;
    } catch (err) {
      console.error(`[platform-discovery] ${src.label} crawl failed`, err);
      return [] as DiscoveryCandidate[];
    }
  });

  return (await Promise.all(jobs)).flat();
}

export function aggregateByHandle(
  candidates: DiscoveryCandidate[]
): Map<string, AggregatedHandle> {
  const now = Date.now();
  const map = new Map<string, AggregatedHandle>();
  for (const c of candidates) {
    const handle = c.igHandle.toLowerCase();
    const ts = new Date(c.date).getTime();
    const src = { sourceId: c.sourceId, title: c.title, date: c.date, url: c.url };
    const existing = map.get(handle);
    if (!existing) {
      map.set(handle, {
        igHandle: handle,
        igProfileUrl: `https://www.instagram.com/${handle}/`,
        displayName: null,
        bio: null,
        followerCount: null,
        avatarUrl: null,
        sources: [src],
        count90d: now - ts <= MS_90D ? 1 : 0,
        count365d: now - ts <= MS_365D ? 1 : 0,
        lastDate: c.date,
      });
    } else {
      existing.sources.push(src);
      if (now - ts <= MS_90D) existing.count90d += 1;
      if (now - ts <= MS_365D) existing.count365d += 1;
      if (new Date(c.date) > new Date(existing.lastDate)) existing.lastDate = c.date;
    }
  }
  return map;
}

export interface ActivityScore {
  tier: "active" | "recent" | "occasional" | "dormant" | "low";
  timing: string;
  priorityScore: number; // 0-100; higher = reach out sooner
}

// Neutral-wording cadence score (works for any vertical, not just events).
export function scoreListingActivity(opts: {
  count90d: number;
  count365d: number;
  lastDateIso: string;
}): ActivityScore {
  const daysSinceLast = Math.floor(
    (Date.now() - new Date(opts.lastDateIso).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (opts.count90d >= 3) {
    return { tier: "active", timing: "Contact now — actively listed", priorityScore: 90 };
  }
  if (daysSinceLast <= 14) {
    return { tier: "recent", timing: "Reach out now — recently active", priorityScore: 80 };
  }
  if (opts.count90d >= 1) {
    return { tier: "occasional", timing: "Good window — listed in last 90 days", priorityScore: 65 };
  }
  if (opts.count365d >= 1) {
    return { tier: "dormant", timing: "Plan ahead — listed in last year", priorityScore: 40 };
  }
  return { tier: "low", timing: "Low signal — no recent listings", priorityScore: 20 };
}

export { enrichHandlesWithIg };
