import { describe, expect, it } from "vitest";
import { emailsOnPage, isBusinessSite, matchesName, nameWords, siteFromBio } from "@/lib/outreach-autopilot/enrich";

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
