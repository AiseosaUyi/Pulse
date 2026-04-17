import { describe, it, expect } from "vitest";
import { brandVoiceSchema, isBrandVoiceComplete } from "@/lib/ai/brand-voice";

describe("brandVoiceSchema", () => {
  const valid = {
    tone: "playful",
    audience: "young Lagos",
    do_list: ["be authentic"],
    dont_list: ["no corporate speak"],
    example_posts: ["Sunset hits different"],
  };

  it("accepts a complete voice", () => {
    expect(brandVoiceSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing tone", () => {
    const { tone: _tone, ...rest } = valid;
    expect(brandVoiceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty do_list", () => {
    expect(
      brandVoiceSchema.safeParse({ ...valid, do_list: [] }).success
    ).toBe(false);
  });

  it("rejects empty example_posts", () => {
    expect(
      brandVoiceSchema.safeParse({ ...valid, example_posts: [] }).success
    ).toBe(false);
  });

  it("rejects empty string entries", () => {
    expect(
      brandVoiceSchema.safeParse({ ...valid, do_list: [""] }).success
    ).toBe(false);
  });
});

describe("isBrandVoiceComplete", () => {
  it("returns true for valid voice", () => {
    expect(
      isBrandVoiceComplete({
        tone: "x",
        audience: "x",
        do_list: ["x"],
        dont_list: ["x"],
        example_posts: ["x"],
      })
    ).toBe(true);
  });

  it("returns false for null", () => {
    expect(isBrandVoiceComplete(null)).toBe(false);
  });

  it("returns false for partial voice", () => {
    expect(isBrandVoiceComplete({ tone: "only this" })).toBe(false);
  });
});
