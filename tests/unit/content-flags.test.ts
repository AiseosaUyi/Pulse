import { describe, it, expect } from "vitest";
import {
  scanForFabrication,
  scanForVoiceViolations,
  stripBannedDashes,
} from "@/lib/blog/content-flags";
import type { BrandVoice } from "@/lib/ai/brand-voice";

// Regression coverage for the sippy fabrication incident: blog post
// 033f3f42 shipped invented delivery-time claims, a fabricated on-time
// rate, named testimonials for people who don't exist, and invented
// competitor prices. Every pattern below is drawn directly from that post.

const sippyVoice: BrandVoice = {
  tone: "Bold, warm, street smart, trustworthy.",
  audience: "Lagos drink buyers.",
  do_list: ["Name real drink brands"],
  dont_list: ["Never use em dashes or en dashes, they read as AI written"],
  example_posts: [],
};

describe("scanForFabrication", () => {
  it("flags a fabricated on-time percentage", () => {
    const flags = scanForFabrication("Over 96% of Sippy orders arrive on time.");
    expect(flags.some((f) => f.type === "unverified_stat")).toBe(true);
  });

  it("flags an invented delivery-time guarantee", () => {
    const flags = scanForFabrication("we'll have those bottles cold at your door in under 30 minutes.");
    expect(flags.some((f) => f.type === "time_guarantee")).toBe(true);
  });

  it("flags a named testimonial", () => {
    const flags = scanForFabrication("Natasha, a Surulere planner, always orders from us.");
    expect(flags.some((f) => f.type === "named_testimonial")).toBe(true);
  });

  it("flags an invented competitor price comparison", () => {
    const flags = scanForFabrication("open market price for a carton of Smirnoff Ice was N9,400-N9,800.");
    expect(flags.some((f) => f.type === "competitor_price")).toBe(true);
  });

  it("does not flag clean prose with no numbers, quotes, or guarantees", () => {
    const flags = scanForFabrication("Pick a beer lineup your guests will love and order it today.");
    expect(flags).toHaveLength(0);
  });
});

describe("scanForVoiceViolations", () => {
  it("flags em/en dashes when the tenant's dont_list forbids them", () => {
    const flags = scanForVoiceViolations("The right beer lineup keeps the vibe going—no one wants warm drinks.", sippyVoice);
    expect(flags.some((f) => f.type === "banned_dash")).toBe(true);
  });

  it("does not flag dashes for a tenant whose voice says nothing about them", () => {
    const otherVoice: BrandVoice = { ...sippyVoice, dont_list: ["Never sound corporate"] };
    const flags = scanForVoiceViolations("The vibe—unmatched.", otherVoice);
    expect(flags).toHaveLength(0);
  });

  it("returns no flags when voice is null", () => {
    expect(scanForVoiceViolations("The vibe—unmatched.", null)).toHaveLength(0);
  });
});

describe("stripBannedDashes", () => {
  it("replaces em/en dashes with a comma for a tenant that forbids them", () => {
    const out = stripBannedDashes("clubs—the right beer lineup keeps guests refreshed", sippyVoice);
    expect(out).not.toMatch(/[—–]/);
    expect(out).toBe("clubs, the right beer lineup keeps guests refreshed");
  });

  it("leaves numeric hyphen ranges untouched (not em/en dashes)", () => {
    const out = stripBannedDashes("9,400-9,800", sippyVoice);
    expect(out).toBe("9,400-9,800");
  });

  it("is a no-op for a tenant whose voice doesn't forbid dashes", () => {
    const otherVoice: BrandVoice = { ...sippyVoice, dont_list: ["Never sound corporate"] };
    const out = stripBannedDashes("The vibe—unmatched.", otherVoice);
    expect(out).toBe("The vibe—unmatched.");
  });
});
