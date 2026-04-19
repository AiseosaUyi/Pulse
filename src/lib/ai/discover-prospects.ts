// Autonomous prospect discovery. Given a saved prospect_search row
// (platform + signal_type + query), fire a Google site-search through
// the existing SERP infrastructure and parse the results into
// prospect candidates. No AI call here — this is pure scraping +
// URL parsing. The runner upstream decides whether to qualify each
// candidate with qualifyProspectAi afterwards.
//
// Why Google site search rather than a direct platform API?
//   - IG/TikTok don't offer public search APIs for non-business
//     accounts at any useful volume.
//   - Serper is already configured (SERPER_API_KEY, 2,500 free/mo)
//     and has Apify fallback. Zero new infra.
//   - Google indexes profile pages, so `site:instagram.com "<query>"`
//     returns real IG profile URLs we can turn into handles.

import { scrapeGoogleSerp, type SerpResult } from "@/lib/scrape/google-serp";
import {
  detectFromUrl,
  siteSearchQueryFor,
} from "@/lib/outbound/handle";
import type {
  OutboundPlatform,
  ProspectSearchRecord,
  SignalType,
} from "@/lib/types/outbound";

export interface ProspectCandidate {
  platform: OutboundPlatform;
  handle: string;
  profileUrl: string;
  /** Human summary of why the prospect surfaced — goes on the
   *  prospect row so the operator (and AI qualifier) see context. */
  signalSummary: string;
  /** Raw signal payload — kept so we can evolve without migrations. */
  signalData: Record<string, unknown>;
}

export interface DiscoverySearchInput {
  platform: OutboundPlatform;
  signalType: SignalType;
  query: string;
  filters: Record<string, unknown>;
  /** Max candidates to return after dedup. */
  limit?: number;
  /** Two-letter country code for the SERP call. Defaults to 'ng'. */
  region?: string;
}

export interface DiscoveryResult {
  candidates: ProspectCandidate[];
  /** The actual query string sent to Google — useful for debugging. */
  queryUsed: string;
  /** How many raw SERP results came back before dedup. */
  rawResultCount: number;
}

/**
 * Map a saved prospect_search row to a DiscoverySearchInput. Public
 * so both the cron and the on-demand action can call runDiscoverySearch
 * with a typed input.
 */
export function inputFromSearch(
  search: ProspectSearchRecord,
  overrides: Partial<DiscoverySearchInput> = {}
): DiscoverySearchInput {
  return {
    platform: search.platform,
    signalType: search.signalType,
    query: search.query,
    filters: search.filters,
    limit: overrides.limit ?? 20,
    region: overrides.region ?? "ng",
  };
}

function buildSignalSummary(
  signalType: SignalType,
  query: string,
  serp: SerpResult
): string {
  switch (signalType) {
    case "keyword":
      return `Matched keyword "${query}": ${truncate(serp.title, 80)}`;
    case "hashtag":
      return `Hashtag ${query}: ${truncate(serp.snippet, 120)}`;
    case "event_host":
      return `Event host signal on "${query}": ${truncate(serp.title, 80)}`;
    case "event_attendee":
      return `Event attendee signal on "${query}": ${truncate(serp.snippet, 120)}`;
    case "recent_post":
      return `Recent post about "${query}": ${truncate(serp.title, 80)}`;
    case "manual":
    default:
      return truncate(serp.title, 120);
  }
}

function truncate(text: string | undefined, max: number): string {
  const s = (text ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export async function runDiscoverySearch(
  input: DiscoverySearchInput
): Promise<DiscoveryResult> {
  const queryUsed = siteSearchQueryFor(input.platform, input.query);
  const serp = await scrapeGoogleSerp({
    query: queryUsed,
    region: input.region,
    limit: input.limit ?? 20,
  });

  const seen = new Set<string>();
  const candidates: ProspectCandidate[] = [];

  for (const result of serp) {
    const detected = detectFromUrl(result.url);
    if (!detected) continue;
    if (detected.platform !== input.platform) continue;
    const dedupKey = `${detected.platform}:${detected.handle}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    candidates.push({
      platform: detected.platform,
      handle: detected.handle,
      profileUrl: detected.profileUrl,
      signalSummary: buildSignalSummary(input.signalType, input.query, result),
      signalData: {
        signal_type: input.signalType,
        query: input.query,
        serp_title: result.title,
        serp_snippet: result.snippet,
        serp_url: result.url,
        serp_position: result.position,
      },
    });
  }

  return {
    candidates,
    queryUsed,
    rawResultCount: serp.length,
  };
}
