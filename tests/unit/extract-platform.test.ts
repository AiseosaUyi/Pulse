import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { detectPlatform } from "@/lib/scrape/extract-platform";

// Two suites: one without COBALT_API_URL (IG/YT/X/FB are link-only) and
// one with it set (they're extractable via cobalt). TikTok is always
// extractable via tikwm regardless of config.

describe("detectPlatform — no cobalt configured", () => {
  beforeEach(() => {
    vi.stubEnv("COBALT_API_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["https://www.tiktok.com/@user/video/7626364498403691797", "tiktok", true, "tikwm"],
    ["https://tiktok.com/@user/video/123", "tiktok", true, "tikwm"],
    ["https://vm.tiktok.com/ZM8XYZ/", "tiktok", true, "tikwm"],
    ["https://www.instagram.com/p/ABC123/", "instagram", false, null],
    ["https://www.instagram.com/reel/XYZ/", "instagram", false, null],
    ["https://instagram.com/stories/user/123", "instagram", false, null],
    ["https://www.youtube.com/watch?v=abc", "youtube", false, null],
    ["https://youtu.be/abc", "youtube", false, null],
    ["https://m.youtube.com/watch?v=abc", "youtube", false, null],
    ["https://twitter.com/user/status/123", "twitter", false, null],
    ["https://x.com/user/status/123", "twitter", false, null],
    ["https://www.facebook.com/watch?v=123", "facebook", false, null],
    ["https://fb.watch/abc", "facebook", false, null],
    ["https://www.linkedin.com/posts/activity-123", "linkedin", false, null],
    ["https://example.com/post", "manual", false, null],
    ["not a url", "manual", false, null],
    ["", "manual", false, null],
  ])("classifies %s", (url, platform, canExtract, extractor) => {
    const r = detectPlatform(url);
    expect(r.platform).toBe(platform);
    expect(r.canExtract).toBe(canExtract);
    expect(r.extractor).toBe(extractor);
  });

  it("hints at cobalt setup in the link-only message for IG", () => {
    expect(detectPlatform("https://instagram.com/p/abc/").linkOnlyReason).toMatch(
      /COBALT_API_URL/
    );
  });

  it("LinkedIn is deliberately opted out regardless of config", () => {
    const r = detectPlatform("https://linkedin.com/posts/x");
    expect(r.canExtract).toBe(false);
    expect(r.linkOnlyReason).toMatch(/protect your account/i);
  });

  it("omits linkOnlyReason for extractable platforms (TikTok)", () => {
    expect(
      detectPlatform("https://tiktok.com/@u/video/1").linkOnlyReason
    ).toBeUndefined();
  });
});

describe("detectPlatform — cobalt configured", () => {
  beforeEach(() => {
    vi.stubEnv("COBALT_API_URL", "https://pulse-cobalt.onrender.com/");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["https://instagram.com/p/abc/", "instagram"],
    ["https://instagram.com/reel/abc/", "instagram"],
    ["https://youtu.be/abc", "youtube"],
    ["https://www.youtube.com/watch?v=abc", "youtube"],
    ["https://x.com/u/status/1", "twitter"],
    ["https://twitter.com/u/status/1", "twitter"],
    ["https://facebook.com/watch?v=1", "facebook"],
    ["https://fb.watch/a", "facebook"],
  ])("makes %s extractable via cobalt", (url, platform) => {
    const r = detectPlatform(url);
    expect(r.platform).toBe(platform);
    expect(r.canExtract).toBe(true);
    expect(r.extractor).toBe("cobalt");
    expect(r.linkOnlyReason).toBeUndefined();
  });

  it("LinkedIn still opts out", () => {
    const r = detectPlatform("https://linkedin.com/posts/x");
    expect(r.canExtract).toBe(false);
    expect(r.extractor).toBeNull();
  });

  it("TikTok still uses tikwm, not cobalt", () => {
    expect(detectPlatform("https://tiktok.com/@u/video/1").extractor).toBe(
      "tikwm"
    );
  });
});
