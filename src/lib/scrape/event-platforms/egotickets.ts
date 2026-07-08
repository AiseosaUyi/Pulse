// eGotickets — confirmed server-rendered listing (DOM research, 2026-07-08):
// each event is `a.group.block[href="/events/slug"]` with `h3` (title),
// a category `<p>`, a day/month pair (no year shown on the card), and a
// price span following a "Tickets" label. Multi-currency (spans Ghana,
// Nigeria, Kenya, Rwanda) — priceRaw is stored as shown, not normalized.
// No organizer name is exposed on the listing card; detail-page regex
// fallback below mirrors the existing "organized/hosted/presented by"
// pattern already used for Jetron/Luma/Tix.africa (ticketing-platforms.ts).

import * as cheerio from "cheerio";
import { fetchEventHtml } from "@/lib/scrape/event-fetch";
import type { EventCandidate, EventPlatformConfig } from "./types";

const BASE_URL = "https://egotickets.com";
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Cards show a day + month abbreviation with no year. Pick the nearest
// future occurrence of that day/month (this year, or next year if it's
// already passed) — same "best guess" approach as toIsoDate() elsewhere.
function nearestFutureDate(day: string, monthAbbr: string): string {
  const month = MONTHS[monthAbbr.toLowerCase().slice(0, 3)];
  const dayNum = parseInt(day, 10);
  if (month === undefined || isNaN(dayNum)) {
    return new Date().toISOString().slice(0, 10);
  }
  const now = new Date();
  let year = now.getFullYear();
  let candidate = new Date(Date.UTC(year, month, dayNum));
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    year += 1;
    candidate = new Date(Date.UTC(year, month, dayNum));
  }
  return candidate.toISOString().slice(0, 10);
}

export function parseEgoticketsListing(
  html: string,
  sourceUrl: string
): EventCandidate[] {
  const $ = cheerio.load(html);
  const out: EventCandidate[] = [];

  $("a.group.block[href]").each((_, el) => {
    const card = $(el);
    const href = card.attr("href");
    const title = card.find("h3").first().text().trim();
    if (!href || !title) return;

    const eventUrl = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
    const day = card.find(".text-ego-orange").first().text().trim();
    const month = card.find(".font-bold.text-xs.uppercase").first().text().trim();
    const eventDate = day && month ? nearestFutureDate(day, month) : new Date().toISOString().slice(0, 10);

    const category = card.find("p.text-gray-600.text-xs").first().text().trim() || null;

    // Price sits in a span following a "Tickets" label div — find the label,
    // then the price span that's a sibling within the same info block.
    let priceRaw: string | null = null;
    card.find("div").each((_i, labelEl) => {
      const labelText = $(labelEl).text().trim();
      if (/^tickets$/i.test(labelText)) {
        const priceSpan = $(labelEl).parent().find("span").first();
        const text = priceSpan.text().trim();
        if (text) priceRaw = text;
      }
    });
    const isPaid = !!priceRaw && !/free/i.test(priceRaw);

    out.push({
      platformId: "egotickets",
      eventTitle: title.slice(0, 200),
      eventUrl,
      eventDate,
      priceRaw: isPaid ? priceRaw : null,
      isPaid,
      organizerName: null,
      category,
    });
  });

  if (out.length === 0) {
    console.warn(`[egotickets] no a.group.block elements found on ${sourceUrl} — selectors may be stale`);
  }
  return out;
}

const ORGANIZER_RE = /(?:organi[sz]ed|hosted|presented) by[:\s]+([^\n,<]{2,80})/i;

export async function resolveEgoticketsOrganizer(
  candidate: EventCandidate
): Promise<string | null> {
  try {
    const { html } = await fetchEventHtml(candidate.eventUrl);
    const $ = cheerio.load(html);
    const text = $("body").text();
    const match = ORGANIZER_RE.exec(text);
    return match ? match[1].trim() : null;
  } catch (err) {
    console.error(`[egotickets] organizer resolve failed for ${candidate.eventUrl}`, err);
    return null;
  }
}

export const egoticketsConfig: EventPlatformConfig = {
  id: "egotickets",
  label: "eGotickets",
  status: "active",
  researchNote:
    "Server-rendered event cards with visible price, category, and day/month. Organizer name not on the card — detail-page regex fallback, same pattern as existing Jetron/Luma/Tix.africa parsers.",
  listingUrls: ["https://egotickets.com/", "https://egotickets.com/events"],
  parseListing: parseEgoticketsListing,
  resolveOrganizer: resolveEgoticketsOrganizer,
};
