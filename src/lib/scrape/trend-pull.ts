// Trend-sourcing for the individual-persona content calendar. Deliberately
// NOT reusing Trend Scouts / Intel Feed / X Listening (startup-persona
// infra that Gruve/Sippy depend on) — a bug in this brand-new, unvalidated
// feature must not risk their existing trend feeds. See the design doc's
// "ENG REVIEW" section, locked decision #2.
//
// Two free/cheap sources, no new API keys beyond what's already configured:
//   - Hacker News (Algolia search API, no key) — "evergreen but currently
//     hot" AI/tech discussion.
//   - Serper (already used by Outbound's google-serp.ts) — a narrow news
//     search for anything genuinely breaking today.
//
// Fetched ONCE per batch-generation call and shared across all N slots in
// that batch (see content-calendar.ts) — not re-fetched per slot.

import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";

export interface TrendCandidate {
  title: string;
  url: string;
  source: "hn" | "serper";
  points?: number;
}

const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const HN_TIMEOUT_MS = 8_000;

async function fetchHackerNewsTrends(niche: string): Promise<TrendCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HN_TIMEOUT_MS);
  try {
    const url = new URL(HN_SEARCH_URL);
    url.searchParams.set("query", niche);
    url.searchParams.set("tags", "story");
    url.searchParams.set("numericFilters", `created_at_i>${Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60}`);
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits?: Array<{ title?: string | null; url?: string | null; points?: number; objectID: string }>;
    };
    return (data.hits ?? [])
      .filter((h) => !!h.title)
      .map((h) => ({
        title: h.title as string,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: "hn" as const,
        points: h.points,
      }));
  } catch (err) {
    console.warn("[trend-pull] Hacker News fetch failed", err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSerperTrends(niche: string): Promise<TrendCandidate[]> {
  try {
    const results = await scrapeGoogleSerp({
      query: `${niche} news today`,
      region: "us",
      limit: 5,
    });
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      source: "serper" as const,
    }));
  } catch (err) {
    console.warn("[trend-pull] Serper fetch failed", err);
    return [];
  }
}

// Fetches once, meant to be called a single time per batch-generation
// invocation and passed to every slot's topic-selection call — see the
// call site in content-calendar.ts for why (avoids N redundant fetches
// of identical "what's trending" data within one batch).
export async function fetchTrendCandidates(niche: string): Promise<TrendCandidate[]> {
  const [hn, serper] = await Promise.all([
    fetchHackerNewsTrends(niche),
    fetchSerperTrends(niche),
  ]);
  return [...hn, ...serper];
}
