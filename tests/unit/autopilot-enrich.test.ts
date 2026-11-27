import { describe, expect, it } from "vitest";
import {
  emailsOnPage,
  isBusinessSite,
  matchesName,
  nameWords,
  selectEnrichCandidates,
  siteFromBio,
} from "@/lib/outreach-autopilot/enrich";
import { FakeDb, fakeClient } from "../helpers/fake-db";

describe("which leads get searched first", () => {
  const retryBefore = "2026-10-28T00:00:00.000Z";
  const lead = (id: string, status: string, created_at: string, extra: Record<string, unknown> = {}) => ({
    id,
    tenant_slug: "sippy",
    status,
    created_at,
    email_status: null,
    email_searched_at: null,
    ...extra,
  });

  it("puts replied, then qualified, then new leads first, newest first inside each", async () => {
    const db = new FakeDb({
      prospects: [
        lead("new-old", "new", "2026-11-01"),
        lead("new-young", "new", "2026-11-20"),
        lead("qual-old", "qualified", "2026-10-01"),
        lead("qual-young", "qualified", "2026-11-10"),
        lead("replied", "replied", "2026-09-01"),
      ],
    });
    const got = await selectEnrichCandidates(fakeClient(db), "sippy", 10, retryBefore);
    expect(got.map((c) => c.id)).toEqual(["replied", "qual-young", "qual-old", "new-young", "new-old"]);
  });

  it("fills the cap from the best tiers and stops", async () => {
    const db = new FakeDb({
      prospects: [lead("n1", "new", "2026-11-20"), lead("q1", "qualified", "2026-01-01"), lead("q2", "qualified", "2026-02-01")],
    });
    const got = await selectEnrichCandidates(fakeClient(db), "sippy", 2, retryBefore);
    expect(got.map((c) => c.id)).toEqual(["q2", "q1"]);
  });

  it("skips leads with an email, searched recently, closed, or in another workspace", async () => {
    const db = new FakeDb({
      prospects: [
        lead("has-email", "qualified", "2026-11-01", { email_status: "verified" }),
        lead("searched-recently", "qualified", "2026-11-01", { email_searched_at: "2026-11-20T00:00:00.000Z" }),
        lead("due-again", "qualified", "2026-11-01", { email_searched_at: "2026-09-01T00:00:00.000Z" }),
        lead("closed", "closed_lost", "2026-11-01"),
        lead("dismissed", "dismissed", "2026-11-01"),
        lead("other-tenant", "new", "2026-11-01", { tenant_slug: "gruve" }),
      ],
    });
    const got = await selectEnrichCandidates(fakeClient(db), "sippy", 10, retryBefore);
    expect(got.map((c) => c.id)).toEqual(["due-again"]);
  });
});

describe("finding a lead's website", () => {
  it("never treats social, link-in-bio or ticketing sites as the business site", () => {
    for (const u of [
      "https://www.instagram.com/foo",
      "https://linktr.ee/foo",
      "https://wa.me/234800",
      "https://www.eventbrite.com/e/123",
      "https://lu.ma/x",
      "https://bit.ly/abc",
      "https://m.facebook.com/foo",
    ]) expect(isBusinessSite(u), u).toBe(false);
    expect(isBusinessSite("https://www.thebarlagos.com")).toBe(true);
  });

  it("takes the first real site from a bio", () => {
    expect(siteFromBio("Bookings via linktr.ee/x or www.skyloungelagos.com today")).toBe("https://www.skyloungelagos.com");
    expect(siteFromBio("DM to book https://instagram.com/x")).toBeNull();
    expect(siteFromBio(null)).toBeNull();
  });

  it("only accepts a search hit that shares a word with the lead's name", () => {
    const words = nameWords("Skyline Lounge", "@skyline_lagos");
    expect(matchesName({ url: "https://skylinelounge.ng", title: "Home" }, words)).toBe(true);
    expect(matchesName({ url: "https://randombar.com", title: "Best bars in Lagos" }, words)).toBe(false);
    expect(matchesName({ url: "https://instagram.com/skyline", title: "Skyline" }, words)).toBe(false);
  });

  it("ignores filler words when matching names", () => {
    expect(nameWords("The Events Company Lagos")).toEqual([]);
  });
});

describe("emailsOnPage", () => {
  it("keeps only addresses on the site's own domain, role addresses first", () => {
    const html = `<a href="mailto:jane@skyline.ng">Jane</a> info&#64;skyline.ng foo@gmail.com x@other.com logo@2x.png`;
    expect(emailsOnPage(html, "https://www.skyline.ng")).toEqual(["info@skyline.ng", "jane@skyline.ng"]);
  });
});
