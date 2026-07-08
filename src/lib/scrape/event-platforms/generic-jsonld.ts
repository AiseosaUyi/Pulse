// Generic fallback parser for platforms where DOM research (2026-07-08)
// found real page content but no confirmed listing-page markup with a
// direct price signal — Syticks, Obodo, Unboxd, Tiqbuy, Tixvnt. Rather than
// fabricate CSS selectors for markup nobody has actually inspected, this
// reads schema.org Event JSON-LD if the platform embeds it (common for SEO)
// and returns nothing otherwise — honest "unconfirmed, needs real selector
// work" behavior instead of a scraper that silently produces garbage.
//
// Status intentionally stays "unconfirmed" in each platform's config
// (types.ts) until someone verifies real Event JSON-LD or writes a proper
// per-platform parser like shows-ng.ts / egotickets.ts.

import * as cheerio from "cheerio";
import type { EventCandidate } from "./types";

interface JsonLdEvent {
  "@type"?: string | string[];
  name?: string;
  url?: string;
  startDate?: string;
  organizer?: { name?: string } | string;
  offers?: { price?: string | number; priceCurrency?: string } | Array<{ price?: string | number; priceCurrency?: string }>;
}

function isEventType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => t.toLowerCase().includes("event"));
}

export function parseGenericJsonLd(
  platformId: string,
  html: string,
  sourceUrl: string
): EventCandidate[] {
  const $ = cheerio.load(html);
  const out: EventCandidate[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const events: JsonLdEvent[] =
        typeof item === "object" && item !== null && "@graph" in item
          ? ((item as { "@graph": unknown[] })["@graph"] as JsonLdEvent[])
          : [item as JsonLdEvent];

      for (const ev of events) {
        if (!ev || !isEventType(ev["@type"])) continue;
        const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers;
        const price = offers?.price;
        const currency = offers?.priceCurrency ?? "";
        const isPaid = price !== undefined && price !== null && Number(price) > 0;
        const organizerName =
          typeof ev.organizer === "string" ? ev.organizer : ev.organizer?.name ?? null;

        if (!ev.name || !ev.url) continue;
        out.push({
          platformId,
          eventTitle: ev.name.slice(0, 200),
          eventUrl: ev.url,
          eventDate: ev.startDate ? ev.startDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
          priceRaw: isPaid ? `${currency} ${price}`.trim() : null,
          isPaid,
          organizerName,
          category: null,
        });
      }
    }
  });

  if (out.length === 0) {
    console.warn(
      `[${platformId}] no schema.org Event JSON-LD found on ${sourceUrl} — this platform needs a real per-platform parser (see shows-ng.ts for the pattern), not the generic fallback`
    );
  }
  return out;
}
