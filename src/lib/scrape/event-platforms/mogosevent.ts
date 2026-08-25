// MogosEvent — confirmed server-rendered listing (DOM research, 2026-08-18):
// each event is `div.popular-item` with `.popular-item__title a[href]`
// (title + URL), a `.popular-list__item` date line ("25 Oct, 2026 - 25 Oct,
// 2026"), a `.price` node ("Free" or "From #15,000.00" — Naira shown as
// "#", not "₦"), and — unlike shows.ng/egotickets — the organizer name is
// already inline as `.popular-item__left .name a`, so no second detail-page
// fetch is needed at all.
//
// Note: fewer events overall than shows.ng/egotickets in this pass (only 4
// cards on /events at research time), but the listing genuinely serves
// paid events with real prices, so it's worth including.

import * as cheerio from "cheerio";
import type { EventCandidate, EventPlatformConfig } from "./types";

const BASE_URL = "https://mogosevent.com";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Cards show "25 Oct, 2026 - 25 Oct, 2026" (start - end, same format both
// sides). Build the ISO string by hand from the first date instead of
// `new Date(...)` — that shifts a day under UTC-behind timezones (verified:
// `new Date("25 Oct, 2026")` prints 2026-10-24 on this machine).
function parseEventDate(raw: string): string {
  const match = /(\d{1,2})\s+([A-Za-z]{3,})[,]?\s+(\d{4})/.exec(raw);
  if (!match) return new Date().toISOString().slice(0, 10);
  const [, day, monthName, year] = match;
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (!month) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

// "Free" → not paid. "From #15,000.00" / "From: #15,000.00" (both variants
// seen live) → paid, keep the raw text as shown (Naira shorthand "#", not
// normalized — same approach as egotickets.ts's multi-currency priceRaw).
function parsePrice(raw: string): { priceRaw: string | null; isPaid: boolean } {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed || /^free$/i.test(trimmed)) return { priceRaw: null, isPaid: false };
  return { priceRaw: trimmed, isPaid: true };
}

export function parseMogosEventListing(
  html: string,
  sourceUrl: string
): EventCandidate[] {
  const $ = cheerio.load(html);
  const out: EventCandidate[] = [];

  $("div.popular-item").each((_, el) => {
    const card = $(el);
    const link = card.find(".popular-item__title a[href]").first();
    const title = link.text().trim();
    const href = link.attr("href");
    if (!title || !href) return;

    const eventUrl = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\/+/, "")}`;
    const dateText = card.find(".popular-list__item").first().text();
    const eventDate = parseEventDate(dateText);
    const { priceRaw, isPaid } = parsePrice(card.find(".price").first().text());
    const organizerName = card.find(".popular-item__left .name a").first().text().trim() || null;

    out.push({
      platformId: "mogosevent",
      eventTitle: title.slice(0, 200),
      eventUrl,
      eventDate,
      priceRaw,
      isPaid,
      organizerName,
      category: null,
    });
  });

  if (out.length === 0) {
    console.warn(`[mogosevent] no div.popular-item elements found on ${sourceUrl} — selectors may be stale`);
  }
  return out;
}

export const mogosEventConfig: EventPlatformConfig = {
  id: "mogosevent",
  label: "MogosEvent",
  status: "active",
  researchNote:
    "Added 2026-08-18 (user-suggested search for more platforms). VERIFIED via plain fetch: /events is fully server-rendered with real event cards — title, date, venue, price (both free and real Naira prices confirmed, e.g. 'From #15,000.00'), AND the organizer name + profile link inline on the card itself. No detail-page fetch needed at all, unlike shows.ng/egotickets.",
  listingUrls: ["https://mogosevent.com/events"],
  parseListing: parseMogosEventListing,
};
