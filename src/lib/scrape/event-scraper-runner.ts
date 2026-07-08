// Orchestrates one event-platform scrape: fetch listing(s) → parse → filter
// to paid/ticketed events only (design doc: only commercial events qualify
// as leads) → resolve organizer name (per-platform, if available) → resolve
// a social handle via the existing SERP fallback (no new infra) → upsert
// into prospects exactly like the Apify-based pipeline, tagged with a
// distinct signal_type so the two lineages stay distinguishable.
//
// No Apify anywhere in this file — see event-fetch.ts for why.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchEventHtml, EventFetchError } from "@/lib/scrape/event-fetch";
import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";
import { detectFromUrl, siteSearchQueryFor } from "@/lib/outbound/handle";
import { parseGenericJsonLd } from "@/lib/scrape/event-platforms/generic-jsonld";
import type { EventCandidate, EventPlatformConfig } from "@/lib/scrape/event-platforms/types";
import {
  withEventScraperRun,
  type EventScraperRunResult,
} from "@/lib/cron/event-scraper-run-tracker";

// Reactive-only blocking policy (design doc, cost constraint: no proxy
// pre-purchased). If a platform returns zero candidates this many
// consecutive runs after previously producing results, that's the signal to
// manually check for a 403/CAPTCHA and consider a proxy — not before.
export const BLOCK_DETECTION_CONSECUTIVE_EMPTY_RUNS = 5;

function slugifyForHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unknown";
}

async function resolveHandleViaSerp(
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

  const t0 = Date.now();
  const rows = await Promise.all(
    deduped.map(async (c) => {
      let organizerName = c.organizerName;
      if (!organizerName && resolveOrganizer) {
        organizerName = await resolveOrganizer(c);
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
    })
  );

  await recordStep({
    step: "resolve_organizer_and_handle",
    status: "ok",
    durationMs: Date.now() - t0,
    payload: { resolvedCount: rows.filter((r) => r.platform !== "manual").length, total: rows.length },
  });

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

  return upserted?.length ?? 0;
}
