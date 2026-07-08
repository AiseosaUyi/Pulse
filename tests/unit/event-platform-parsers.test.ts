import { describe, it, expect, vi } from "vitest";
import { parseEgoticketsListing } from "@/lib/scrape/event-platforms/egotickets";
import { parseGenericJsonLd } from "@/lib/scrape/event-platforms/generic-jsonld";

// Mocked before importing shows-ng.ts so resolveShowsNgOrganizer's real
// fetchEventHtml call never hits the network.
vi.mock("@/lib/scrape/event-fetch", () => ({
  fetchEventHtml: vi.fn(),
}));

const { parseShowsNgListing, resolveShowsNgOrganizer } = await import(
  "@/lib/scrape/event-platforms/shows-ng"
);
const { fetchEventHtml } = await import("@/lib/scrape/event-fetch");

// Fixtures below are trimmed reproductions of real markup captured during
// DOM research (2026-07-08) — not full pages, just the structural shape
// each parser depends on.

const SHOWS_NG_FIXTURE = `
<html><body>
<div id="evs">
  <article class="card" data-start="2026-07-17T16:00:00+00:00" data-id="E-AB39DBA2">
    <div class="body">
      <div class="meta-row">
        <div class="left-meta">
          <div class="badge">Music</div>
        </div>
        <div class="from"><span class="from-label">From</span><span class="price">₦5,000.00</span></div>
      </div>
      <h5><a href="event/nemesis-a-tale-of-two-soldiers-a-stage-play">NEMESIS: A Tale Of Two Soldiers.</a></h5>
    </div>
  </article>
  <article class="card" data-start="2026-08-01T18:00:00+00:00" data-id="E-FREE001">
    <div class="body">
      <div class="meta-row">
        <div class="left-meta"><div class="badge">Community</div></div>
        <div class="from"><span class="price">Free</span></div>
      </div>
      <h5><a href="event/free-meetup">Free Tech Meetup</a></h5>
    </div>
  </article>
</div>
</body></html>
`;

const EGOTICKETS_FIXTURE = `
<html><body>
<div class="grid">
  <a class="group block" href="/events/babes-bikinis">
    <div class="relative">
      <div><div class="text-ego-orange">11</div><div class="font-bold text-xs uppercase">Jul</div></div>
      <div><div>Tickets</div><span>₵50</span></div>
    </div>
    <p class="text-gray-600 text-xs font-semibold uppercase">Nightlife, Party</p>
    <h3>BABES &amp; BIKINIS</h3>
  </a>
</div>
</body></html>
`;

const JSONLD_FIXTURE = `
<html><body>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Lagos Live Concert",
  "url": "https://example.com/events/lagos-live",
  "startDate": "2026-09-10T19:00:00Z",
  "organizer": { "name": "Lagos Live Events" },
  "offers": { "price": "5000", "priceCurrency": "NGN" }
}
</script>
</body></html>
`;

const JSONLD_FREE_FIXTURE = `
<html><body>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Free Community Jam",
  "url": "https://example.com/events/free-jam",
  "startDate": "2026-09-10T19:00:00Z",
  "offers": { "price": "0", "priceCurrency": "NGN" }
}
</script>
</body></html>
`;

describe("parseShowsNgListing", () => {
  it("extracts priced events with title, price, category, date, and url", () => {
    const candidates = parseShowsNgListing(SHOWS_NG_FIXTURE, "https://shows.ng/");
    expect(candidates).toHaveLength(2);

    const priced = candidates.find((c) => c.eventTitle.includes("NEMESIS"));
    expect(priced).toBeDefined();
    expect(priced!.isPaid).toBe(true);
    expect(priced!.priceRaw).toBe("₦5,000.00");
    expect(priced!.category).toBe("Music");
    expect(priced!.eventDate).toBe("2026-07-17");
    expect(priced!.eventUrl).toBe(
      "https://shows.ng/event/nemesis-a-tale-of-two-soldiers-a-stage-play"
    );
    expect(priced!.platformId).toBe("shows_ng");
  });

  it("marks free events as not paid, with no priceRaw", () => {
    const candidates = parseShowsNgListing(SHOWS_NG_FIXTURE, "https://shows.ng/");
    const free = candidates.find((c) => c.eventTitle.includes("Free Tech Meetup"));
    expect(free).toBeDefined();
    expect(free!.isPaid).toBe(false);
    expect(free!.priceRaw).toBeNull();
  });

  it("returns an empty array (not a throw) when selectors find nothing", () => {
    expect(parseShowsNgListing("<html><body>no cards here</body></html>", "https://shows.ng/")).toEqual([]);
  });
});

describe("resolveShowsNgOrganizer", () => {
  // Real markup (2026-07-08 DOM research) HTML-encodes "&" as "&amp;" in
  // the calendar-link href, and the page is full of unrelated "%" (CSS
  // widths etc.) that isn't percent-encoding — both previously caused a
  // silent failure (URIError, and later a regex miss) in production.
  const DETAIL_PAGE_FIXTURE = `
    <html><body>
      <div style="width: 100%; height: 50%">unrelated % signs, not URI-encoded</div>
      <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;dates=20260717T160000Z&amp;details=Date%20and%20time%3A%20Friday%2C%20July%2017%2C%202026%0ADuration%3A%201%20Hr%0AOrganiser%3A%20PHOENIXTRIBEAFRICA%20In%20Collaboration%20With%20NEW%20CULTURE%20STUDIOS%2C%20Ibadan.%0ACategory%3A%20Music">Add to calendar</a>
    </body></html>
  `;

  it("extracts the organizer name from the HTML-encoded calendar link", async () => {
    vi.mocked(fetchEventHtml).mockResolvedValue({
      html: DETAIL_PAGE_FIXTURE,
      finalUrl: "https://shows.ng/event/nemesis",
      httpStatus: 200,
    });
    const organizer = await resolveShowsNgOrganizer({
      platformId: "shows_ng",
      eventTitle: "NEMESIS",
      eventUrl: "https://shows.ng/event/nemesis",
      eventDate: "2026-07-17",
      priceRaw: "₦5,000.00",
      isPaid: true,
      organizerName: null,
      category: "Music",
    });
    expect(organizer).toBe(
      "PHOENIXTRIBEAFRICA In Collaboration With NEW CULTURE STUDIOS, Ibadan."
    );
  });

  it("returns null (not a throw) when there's no calendar link at all", async () => {
    vi.mocked(fetchEventHtml).mockResolvedValue({
      html: "<html><body>no calendar link here, plenty of stray % signs: 50%</body></html>",
      finalUrl: "https://shows.ng/event/x",
      httpStatus: 200,
    });
    const organizer = await resolveShowsNgOrganizer({
      platformId: "shows_ng",
      eventTitle: "X",
      eventUrl: "https://shows.ng/event/x",
      eventDate: "2026-07-17",
      priceRaw: null,
      isPaid: false,
      organizerName: null,
      category: null,
    });
    expect(organizer).toBeNull();
  });

  it("returns null (not a throw) when fetchEventHtml itself fails", async () => {
    vi.mocked(fetchEventHtml).mockRejectedValue(new Error("network error"));
    const organizer = await resolveShowsNgOrganizer({
      platformId: "shows_ng",
      eventTitle: "X",
      eventUrl: "https://shows.ng/event/x",
      eventDate: "2026-07-17",
      priceRaw: null,
      isPaid: false,
      organizerName: null,
      category: null,
    });
    expect(organizer).toBeNull();
  });
});

describe("parseEgoticketsListing", () => {
  it("extracts title, price, category, and constructs a URL from a relative href", () => {
    const candidates = parseEgoticketsListing(EGOTICKETS_FIXTURE, "https://egotickets.com/");
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.eventTitle).toBe("BABES & BIKINIS");
    expect(c.eventUrl).toBe("https://egotickets.com/events/babes-bikinis");
    expect(c.category).toBe("Nightlife, Party");
    expect(c.isPaid).toBe(true);
    expect(c.priceRaw).toBe("₵50");
    expect(c.platformId).toBe("egotickets");
  });

  it("returns an empty array when no cards are found", () => {
    expect(parseEgoticketsListing("<html><body></body></html>", "https://egotickets.com/")).toEqual([]);
  });
});

describe("parseGenericJsonLd", () => {
  it("extracts a priced event from schema.org Event JSON-LD", () => {
    const candidates = parseGenericJsonLd("test_platform", JSONLD_FIXTURE, "https://example.com/");
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.eventTitle).toBe("Lagos Live Concert");
    expect(c.eventUrl).toBe("https://example.com/events/lagos-live");
    expect(c.organizerName).toBe("Lagos Live Events");
    expect(c.isPaid).toBe(true);
    expect(c.priceRaw).toBe("NGN 5000");
    expect(c.platformId).toBe("test_platform");
  });

  it("treats a zero-price offer as not paid", () => {
    const candidates = parseGenericJsonLd("test_platform", JSONLD_FREE_FIXTURE, "https://example.com/");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isPaid).toBe(false);
    expect(candidates[0].priceRaw).toBeNull();
  });

  it("returns an empty array when no Event JSON-LD is present", () => {
    expect(
      parseGenericJsonLd("test_platform", "<html><body>no jsonld</body></html>", "https://example.com/")
    ).toEqual([]);
  });
});
