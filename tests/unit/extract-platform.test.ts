import { describe, it, expect } from "vitest";
import { detectPlatform } from "@/lib/scrape/extract-platform";

describe("detectPlatform", () => {
  it.each([
    ["https://www.tiktok.com/@user/video/7626364498403691797", "tiktok", true],
    ["https://tiktok.com/@user/video/123", "tiktok", true],
    ["https://vm.tiktok.com/ZM8XYZ/", "tiktok", true],
    ["https://www.instagram.com/p/ABC123/", "instagram", false],
    ["https://www.instagram.com/reel/XYZ/", "instagram", false],
    ["https://instagram.com/stories/user/123", "instagram", false],
    ["https://www.youtube.com/watch?v=abc", "youtube", false],
    ["https://youtu.be/abc", "youtube", false],
    ["https://m.youtube.com/watch?v=abc", "youtube", false],
    ["https://twitter.com/user/status/123", "twitter", false],
    ["https://x.com/user/status/123", "twitter", false],
    ["https://www.facebook.com/watch?v=123", "facebook", false],
    ["https://fb.watch/abc", "facebook", false],
    ["https://www.linkedin.com/posts/activity-123", "linkedin", false],
    ["https://example.com/post", "manual", false],
    ["not a url", "manual", false],
    ["", "manual", false],
  ])("classifies %s", (url, expectedPlatform, canExtract) => {
    const r = detectPlatform(url);
    expect(r.platform).toBe(expectedPlatform);
    expect(r.canExtract).toBe(canExtract);
  });

  it("attaches a linkOnlyReason for non-extractable platforms", () => {
    expect(detectPlatform("https://instagram.com/p/abc/").linkOnlyReason).toMatch(
      /instagram/i
    );
    expect(detectPlatform("https://example.com/foo").linkOnlyReason).toMatch(
      /link/i
    );
  });

  it("omits linkOnlyReason for extractable platforms", () => {
    expect(
      detectPlatform("https://tiktok.com/@u/video/1").linkOnlyReason
    ).toBeUndefined();
  });
});
