import { describe, it, expect, vi } from "vitest";
import {
  scanForFabrication,
  scanForVoiceViolations,
  scanBlogContent,
  stripBannedDashes,
} from "@/lib/blog/content-flags";
import type { BrandVoice } from "@/lib/ai/brand-voice";

describe("Stage 1 — Content Safety & Validation Pipeline", () => {
  it("detects unverified statistics stated as fact", () => {
    const content = "Our Lagos drinks delivery service has a 99.4% on-time delivery rate.";
    const flags = scanForFabrication(content);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("unverified_stat");
    expect(flags[0].message).toContain("99.4%");
  });

  it("detects unverified delivery time SLAs & guarantees", () => {
    const content = "Order cold beer now and get delivery in under 30 minutes anywhere in Lekki.";
    const flags = scanForFabrication(content);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("time_guarantee");
    expect(flags[0].message).toContain("in under 30 minutes");
  });

  it("detects named customer testimonials", () => {
    const content = 'Natasha, a Surulere planner, said "Sippy saved our weekend party completely!"';
    const flags = scanForFabrication(content);
    expect(flags.some((f) => f.type === "named_testimonial")).toBe(true);
  });

  it("detects competitor pricing stated as fact", () => {
    const content = "While competitors charge ₦45,000 for Hennessy VS, Sippy offers it for ₦38,000.";
    const flags = scanForFabrication(content);
    expect(flags.some((f) => f.type === "competitor_price")).toBe(true);
  });

  it("enforces brand voice em-dash prohibitions when specified in dont_list", () => {
    const voice: BrandVoice = {
      tone: "energetic, direct",
      audience: "party hosts",
      do_list: ["use short sentences"],
      dont_list: ["Don't use em-dashes (—)"],
      example_posts: ["Example post"],
    };
    const content = "Get your drinks delivered — fast, cold, and ready to pour.";
    const violations = scanForVoiceViolations(content, voice);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("banned_dash");

    const cleaned = stripBannedDashes(content, voice);
    expect(cleaned).toBe("Get your drinks delivered, fast, cold, and ready to pour.");
    expect(cleaned).not.toContain("—");
  });
});
