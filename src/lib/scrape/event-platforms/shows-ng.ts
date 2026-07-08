// Shows.ng — confirmed server-rendered listing (DOM research, 2026-07-08):
// each event is `article.card[data-start][data-id]` with `.price`, `.badge`
// (category), and `h5 > a[href]` (title + relative event URL). The detail
// page embeds a Google Calendar "add to calendar" link whose `details=`
// query param is a URL-encoded plain-text block containing an
// `Organiser: <name>` line — the only reliable organizer-name source found
// on this platform (no organizer IG handle is exposed directly; resolved
// via SERP fallback instead, same as the existing pipeline).

import * as cheerio from "cheerio";
import { fetchEventHtml } from "@/lib/scrape/event-fetch";
import type { EventCandidate, EventPlatformConfig } from "./types";

const BASE_URL = "https://shows.ng";

function parsePrice(raw: string): { priceRaw: string | null; isPaid: boolean } {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return { priceRaw: null, isPaid: false };
  const isFree = /^free$/i.test(trimmed);
  return { priceRaw: isFree ? null : trimmed, isPaid: !isFree };
}

export function parseShowsNgListing(
  html: string,
  sourceUrl: string
): EventCandidate[] {
  const $ = cheerio.load(html);
  const out: EventCandidate[] = [];

  $("article.card").each((_, el) => {
    const card = $(el);
    const link = card.find("h5 a[href]").first();
    const title = link.text().trim();
    const href = link.attr("href");
    if (!title || !href) return;

    const eventUrl = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\/+/, "")}`;
    const dataStart = card.attr("data-start");
    const eventDate = dataStart ? dataStart.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const priceText = card.find(".price").first().text();
    const { priceRaw, isPaid } = parsePrice(priceText);
    const category = card.find(".badge").first().text().trim() || null;

    out.push({
      platformId: "shows_ng",
      eventTitle: title.slice(0, 200),
      eventUrl,
      eventDate,
      priceRaw,
      isPaid,
      organizerName: null,
      category,
    });
  });

  if (out.length === 0) {
    console.warn(`[shows-ng] no article.card elements found on ${sourceUrl} — selectors may be stale`);
  }
  return out;
}

// The calendar link's `details=` param decodes to a plain-text block like:
//   "Date and time: ...\nDuration: ...\nOrganiser: NAME\nCategory: ...\n..."
const ORGANISER_RE = /organiser:\s*([^\n<]{2,120})/i;

export async function resolveShowsNgOrganizer(
  candidate: EventCandidate
): Promise<string | null> {
  try {
    const { html } = await fetchEventHtml(candidate.eventUrl);
    const decoded = decodeURIComponent(html.replace(/\+/g, "%20"));
    const match = ORGANISER_RE.exec(decoded);
    return match ? match[1].trim() : null;
  } catch (err) {
    console.error(`[shows-ng] organizer resolve failed for ${candidate.eventUrl}`, err);
    return null;
  }
}

export const showsNgConfig: EventPlatformConfig = {
  id: "shows_ng",
  label: "Shows.ng",
  status: "active",
  researchNote:
    "Server-rendered event cards with visible price + organizer name available via the calendar-link detail page. Best-confirmed platform in this pass.",
  listingUrls: ["https://shows.ng/", "https://shows.ng/next_month_events"],
  parseListing: parseShowsNgListing,
  resolveOrganizer: resolveShowsNgOrganizer,
};
