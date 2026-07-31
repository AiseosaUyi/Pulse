// Orchestrates one event-platform scrape: fetch listing(s) → parse → filter
// to paid/ticketed events only (design doc: only commercial events qualify
// as leads) → resolve organizer name (per-platform, if available) → resolve
// a social handle via the existing SERP fallback (no new infra) → upsert
// into prospects exactly like the Apify-based pipeline, tagged with a
// distinct signal_type so the two lineages stay distinguishable.
//
// The cheerio/JSON-LD paths below (runActiveEventPlatform, resolveAndUpsert)
// use no Apify — see event-fetch.ts for why. runIgMentionScan (bottom of
// this file) is the one exception: Clooza and Partyverse are IG-native
// brands with no real website to scrape (confirmed via DOM research), so
// those two route through the EXISTING Apify Instagram hashtag scraper
// (instagram-hashtag.ts, already paid for by the trend-scout feature)
// instead of a bespoke web scraper.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchEventHtml, EventFetchError } from "@/lib/scrape/event-fetch";
import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";
import { scrapeInstagramTopPosts } from "@/lib/scrape/instagram-hashtag";
import { detectFromUrl, siteSearchQueryFor } from "@/lib/outbound/handle";
import { parseGenericJsonLd } from "@/lib/scrape/event-platforms/generic-jsonld";
import type { EventCandidate, EventPlatformConfig } from "@/lib/scrape/event-platforms/types";
import {
  withEventScraperRun,
  type EventScraperRunResult,
} from "@/lib/cron/event-scraper-run-tracker";
import { mapWithConcurrency } from "@/lib/utils/concurrency";

// Reactive-only blocking policy (design doc, cost constraint: no proxy
// pre-purchased). If a platform returns zero candidates this many
// consecutive runs after previously producing results, that's the signal to
// manually check for a 403/CAPTCHA and consider a proxy — not before.
export const BLOCK_DETECTION_CONSECUTIVE_EMPTY_RUNS = 5;

export function slugifyForHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unknown";
}

// See the note at its call site in resolveAndUpsert for why a bounded-
// concurrency fan-out is used here instead of a plain Promise.all.

// Instagram's post/reel share-card snippet has a stable "<N> likes, <M>
// comments - <handle> on <date>: ..." prefix (confirmed live, 2026-07-08,
// e.g. "31 likes, 9 comments - mcbarrackomed_official on April 13, 2020").
// Google indexes far more individual posts than profile pages for small
// local accounts, so a site:instagram.com search often returns ONLY /p/
// or /reel/ links — detectFromUrl (below) correctly rejects those as
// "not a profile URL", but that discards a real, extractable handle
// sitting right in the snippet. Confirmed on a real failing case
// ("BARRACKOMED"): the profile-URL check alone found nothing, but 2 of
// its top 5 results matched this pattern with the same real handle.
const IG_SNIPPET_HANDLE_RE = /^\d+\s+likes?,\s*\d+\s+comments?\s*-\s*([a-z0-9_.]+)\s+on\s/i;

function extractIgHandleFromSnippet(snippet: string): string | null {
  const match = IG_SNIPPET_HANDLE_RE.exec(snippet.trim());
  return match ? match[1].toLowerCase() : null;
}

// Exported for reuse by /api/ext/event-lead — the extension capture path
// needs the exact same SERP-based handle resolution the cron path uses.
export async function resolveHandleViaSerp(
  query: string
): Promise<{ platform: "instagram"; handle: string; profileUrl: string } | null> {
  try {
    const results = await scrapeGoogleSerp({
      query: siteSearchQueryFor("instagram", `"${query}"`),
      region: "ng",
      limit: 5,
    });
    for (const r of results) {
      const detected = detectFromUrl(r.url);
      if (detected && detected.platform === "instagram") {
        return { platform: "instagram", handle: detected.handle, profileUrl: detected.profileUrl };
      }
    }
    // Broadening the query itself (dropping quotes, trimming suffixes)
    // was tested live and rejected — it surfaces unrelated accounts
    // (false positives) rather than the real organizer, which is worse
    // than staying unresolved. The snippet fallback below only fires on
    // results the exact-phrase query already matched, so it can't
    // introduce a wrong-account risk the way loosening the query would.
    for (const r of results) {
      if (!r.domain.includes("instagram.com")) continue;
      const handle = extractIgHandleFromSnippet(r.snippet);
      if (handle) {
        return {
          platform: "instagram",
          handle,
          profileUrl: `https://www.instagram.com/${handle}/`,
        };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[event-scraper] SERP handle resolution failed for "${query}"`, err);
    return null;
  }
}

async function fetchAndParse(
  config: EventPlatformConfig | { id: string; label: string; listingUrls: string[] },
  parse: (html: string, url: string) => EventCandidate[]
): Promise<EventCandidate[]> {
  const out: EventCandidate[] = [];
  for (const url of config.listingUrls) {
    try {
      const { html } = await fetchEventHtml(url);
      out.push(...parse(html, url));
    } catch (err) {
      const reason =
        err instanceof EventFetchError ? `${err.status} (${err.message})` : String(err);
      console.error(`[event-scraper] ${config.label} fetch failed for ${url}: ${reason}`);
    }
  }
  return out;
}

export interface RunEventPlatformOpts {
  tenantSlug: string;
  trigger: "cron" | "manual";
  triggeredBy?: string | null;
}

// Runs a single built (active) platform config end-to-end.
export async function runActiveEventPlatform(
  config: EventPlatformConfig,
  opts: RunEventPlatformOpts
): Promise<EventScraperRunResult> {
  return withEventScraperRun(
    {
      tenantSlug: opts.tenantSlug,
      platform: config.id,
      provider: "inhouse",
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy,
    },
    async ({ runId, recordStep }) => {
      const t0 = Date.now();
      const all = await fetchAndParse(config, config.parseListing);
      await recordStep({
        step: "fetch_listing",
        status: "ok",
        durationMs: Date.now() - t0,
        payload: { rawCandidates: all.length },
      });

      const paid = all.filter((c) => c.isPaid);
      await recordStep({
        step: "filter_paid",
        status: "ok",
        payload: { rawCandidates: all.length, paidCandidates: paid.length },
      });

      if (paid.length === 0) {
        return { status: "succeeded", candidatesFound: 0, prospectsCreated: 0 };
      }

      const prospectsCreated = await resolveAndUpsert(
        opts.tenantSlug,
        runId,
        config.id,
        config.label,
        paid,
        config.resolveOrganizer,
        recordStep
      );

      return {
        status: "succeeded",
        candidatesFound: paid.length,
        prospectsCreated,
      };
    }
  );
}

// Runs an "unconfirmed" platform through the generic JSON-LD fallback —
// same pipeline, different (best-effort) parser. See generic-jsonld.ts.
export async function runUnconfirmedEventPlatform(
  platform: { id: string; label: string; listingUrls: string[] },
  opts: RunEventPlatformOpts
): Promise<EventScraperRunResult> {
  return withEventScraperRun(
    {
      tenantSlug: opts.tenantSlug,
      platform: platform.id,
      provider: "inhouse",
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy,
    },
    async ({ runId, recordStep }) => {
      const t0 = Date.now();
      const all = await fetchAndParse(platform, (html, url) =>
        parseGenericJsonLd(platform.id, html, url)
      );
      await recordStep({
        step: "fetch_listing",
        status: "ok",
        durationMs: Date.now() - t0,
        payload: { rawCandidates: all.length },
      });

      const paid = all.filter((c) => c.isPaid);
      await recordStep({
        step: "filter_paid",
        status: "ok",
        payload: { rawCandidates: all.length, paidCandidates: paid.length },
      });

      if (paid.length === 0) {
        return { status: "succeeded", candidatesFound: 0, prospectsCreated: 0 };
      }

      const prospectsCreated = await resolveAndUpsert(
        opts.tenantSlug,
        runId,
        platform.id,
        platform.label,
        paid,
        undefined,
        recordStep
      );

      return {
        status: "succeeded",
        candidatesFound: paid.length,
        prospectsCreated,
      };
    }
  );
}

async function resolveAndUpsert(
  tenantSlug: string,
  runId: string,
  platformId: string,
  platformLabel: string,
  candidates: EventCandidate[],
  resolveOrganizer: EventPlatformConfig["resolveOrganizer"],
  recordStep: (step: {
    step: string;
    status: "ok" | "failed" | "skipped";
    durationMs?: number;
    payload?: Record<string, unknown>;
  }) => Promise<void>
): Promise<number> {
  const admin = createAdminClient();

  // Dedup within this run by event URL (a platform's listing + detail
  // pages can surface the same event more than once).
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.eventUrl)) return false;
    seen.add(c.eventUrl);
    return true;
  });

  // Resolving all candidates fully in parallel is a burst of N near-
  // simultaneous requests to the SAME origin from one IP — live evidence
  // (2026-07-08, Shows.ng) showed this pattern resolving 1/9 organizers in
  // production on a run where 7/7 of the identical URLs succeeded when
  // fetched directly (not concurrently) minutes later. Bounded concurrency
  // is a free mitigation to try before reaching for a paid proxy.
  let organizerResolveFailures = 0;
  const t0 = Date.now();
  const rows = await mapWithConcurrency(deduped, 3, async (c) => {
      let organizerName = c.organizerName;
      if (!organizerName && resolveOrganizer) {
        organizerName = await resolveOrganizer(c);
        if (!organizerName) organizerResolveFailures += 1;
      }

      const searchQuery = organizerName ?? c.eventTitle;
      const resolved = await resolveHandleViaSerp(searchQuery);

      const platform = resolved?.platform ?? "manual";
      const handle = resolved?.handle ?? `event-${platformId}-${slugifyForHandle(c.eventTitle)}`;

      return {
        tenant_slug: tenantSlug,
        platform,
        handle,
        display_name: organizerName ?? null,
        profile_url: resolved?.profileUrl ?? null,
        event_title: c.eventTitle,
        category: c.category,
        event_scraper_run_id: runId,
        signal_summary: `[event_platform_scraper] ${c.eventTitle} · ${c.priceRaw ?? "paid"} · ${platformLabel}`,
        signal_data: {
          source_type: "event_platform_scraper",
          platform_id: platformId,
          event_url: c.eventUrl,
          event_date: c.eventDate,
          price_raw: c.priceRaw,
          organizer_name: organizerName,
          resolved_via: resolved ? "serp" : "unresolved",
          qualify_pending: true,
        },
        status: "new",
      };
    });

  await recordStep({
    step: "resolve_organizer_and_handle",
    status: "ok",
    durationMs: Date.now() - t0,
    payload: {
      resolvedCount: rows.filter((r) => r.platform !== "manual").length,
      total: rows.length,
      organizerResolveFailures,
    },
  });

  // Postgres rejects an upsert batch containing two rows with the same
  // conflict key ("ON CONFLICT DO UPDATE command cannot affect row a
  // second time") — confirmed live on eGotickets, where two different
  // events resolved to the same organizer handle in one run. Dedup on
  // the actual (platform, handle) upsert key, not just event URL.
  const byUpsertKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    byUpsertKey.set(`${row.platform}:${row.handle}`, row);
  }
  const dedupedRows = [...byUpsertKey.values()];

  const { data: upserted, error } = await admin
    .from("prospects")
    .upsert(dedupedRows, { onConflict: "tenant_slug,platform,handle" })
    .select("id");

  if (error) {
    await recordStep({ step: "upsert_prospects", status: "failed", payload: { message: error.message } });
    throw new Error(error.message);
  }
  await recordStep({
    step: "upsert_prospects",
    status: "ok",
    payload: { upserted: upserted?.length ?? 0 },
  });

  if ((upserted?.length ?? 0) > 0) {
    console.log(
      `[event-scraper] wrote ${upserted?.length} prospect(s) into tenant=${tenantSlug} via platform=${platformId} (run=${runId}, gate=isEventScraperEnabledForTenant)`
    );
  }

  return upserted?.length ?? 0;
}

// Clooza / Partyverse: neither has a scrapable website (DOM research,
// 2026-07-08 — both are client-rendered SPAs) but both are IG-native event
// brands, so organizers using them surface via branded-hashtag posts. Being
// found here (posting with the platform's hashtag) IS the qualifying
// signal — unlike the web-scraped platforms there's no separate price to
// check, since using the platform at all means running a ticketed event.
export async function runIgMentionScan(
  platformId: string,
  platformLabel: string,
  hashtags: string[],
  opts: RunEventPlatformOpts
): Promise<EventScraperRunResult> {
  return withEventScraperRun(
    {
      tenantSlug: opts.tenantSlug,
      platform: platformId,
      provider: "apify",
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy,
    },
    async ({ runId, recordStep }) => {
      const t0 = Date.now();
      const posts = await scrapeInstagramTopPosts(hashtags, { limitPerHashtag: 15 });
      await recordStep({
        step: "ig_hashtag_scan",
        status: "ok",
        durationMs: Date.now() - t0,
        payload: { hashtags, postsFound: posts.length },
      });

      const withHandle = posts.filter((p) => !!p.owner_handle);
      const seen = new Set<string>();
      const deduped = withHandle.filter((p) => {
        const handle = p.owner_handle!.toLowerCase();
        if (seen.has(handle)) return false;
        seen.add(handle);
        return true;
      });

      if (deduped.length === 0) {
        return { status: "succeeded", candidatesFound: 0, prospectsCreated: 0 };
      }

      const admin = createAdminClient();
      const rows = deduped.map((p) => ({
        tenant_slug: opts.tenantSlug,
        platform: "instagram" as const,
        handle: p.owner_handle!.toLowerCase(),
        profile_url: `https://www.instagram.com/${p.owner_handle!.toLowerCase()}/`,
        signal_summary: `[event_platform_scraper] Posted using ${p.hashtag} (${platformLabel})`,
        signal_data: {
          source_type: "event_platform_scraper",
          platform_id: platformId,
          hashtag: p.hashtag,
          post_url: p.external_url,
          caption_snippet: p.summary,
          qualify_pending: true,
        },
        event_scraper_run_id: runId,
        status: "new",
      }));

      const { data: upserted, error } = await admin
        .from("prospects")
        .upsert(rows, { onConflict: "tenant_slug,platform,handle" })
        .select("id");

      if (error) {
        await recordStep({ step: "upsert_prospects", status: "failed", payload: { message: error.message } });
        throw new Error(error.message);
      }
      await recordStep({
        step: "upsert_prospects",
        status: "ok",
        payload: { upserted: upserted?.length ?? 0 },
      });

      if ((upserted?.length ?? 0) > 0) {
        console.log(
          `[event-scraper] wrote ${upserted?.length} prospect(s) into tenant=${opts.tenantSlug} via platform=${platformId} (run=${runId}, hashtags=${hashtags.join(",")}, gate=isEventScraperEnabledForTenant)`
        );
      }

      return {
        status: "succeeded",
        candidatesFound: deduped.length,
        prospectsCreated: upserted?.length ?? 0,
      };
    }
  );
}
