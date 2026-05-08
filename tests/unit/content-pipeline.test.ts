// Unit tests for content-pipeline actions. The slugify helper is the
// pure-function piece worth tightly testing — DB-bound paths are
// exercised by integration + E2E tests.

import { describe, expect, it } from "vitest";
import { slugifyContentType } from "@/lib/content-pipeline/slug";

describe("slugifyContentType", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyContentType("Behind The Scenes")).toBe("behind-the-scenes");
  });

  it("collapses multiple separators", () => {
    expect(slugifyContentType("UGC   //  testimonial")).toBe(
      "ugc-testimonial"
    );
  });

  it("strips leading and trailing separators", () => {
    expect(slugifyContentType("  -- Promo --  ")).toBe("promo");
  });

  it("treats Memes and memes the same", () => {
    expect(slugifyContentType("Memes")).toBe(slugifyContentType("memes"));
  });

  it("does NOT fuzzy-match (per K6 decision)", () => {
    expect(slugifyContentType("meme")).not.toBe(slugifyContentType("memez"));
    expect(slugifyContentType("meme")).not.toBe(slugifyContentType("memes"));
  });

  it("caps at 40 chars", () => {
    const label = "this is a very very very very very long label name";
    expect(slugifyContentType(label).length).toBeLessThanOrEqual(40);
  });

  it("strips emojis and unicode punctuation", () => {
    expect(slugifyContentType("Promo 🚀 !!!")).toBe("promo");
  });
});
