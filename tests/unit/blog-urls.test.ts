import { describe, it, expect } from "vitest";
import { buildBlogUrls } from "@/lib/seo/blog-urls";

// Regression coverage for the "can't find the published link again" bug:
// a post's staging/live URL must be derivable from its own slug + tenant
// config at any time, not just returned once from the publish action.

describe("buildBlogUrls", () => {
  it("returns null links when the post has no slug yet", () => {
    const urls = buildBlogUrls(null, {
      siteBaseUrl: "https://www.gruve.events",
      stagingBaseUrl: "https://gamma.gruve.events",
      blogPathPrefix: "/blogs",
    });
    expect(urls).toEqual({ liveUrl: null, stagingUrl: null });
  });

  it("builds both URLs from siteBaseUrl/stagingBaseUrl + blogPathPrefix", () => {
    const urls = buildBlogUrls("how-to-throw-a-launch-party", {
      siteBaseUrl: "https://www.gruve.events",
      stagingBaseUrl: "https://gamma.gruve.events",
      blogPathPrefix: "/blogs",
    });
    expect(urls).toEqual({
      liveUrl: "https://www.gruve.events/blogs/how-to-throw-a-launch-party",
      stagingUrl: "https://gamma.gruve.events/blogs/how-to-throw-a-launch-party",
    });
  });

  it("falls back staging to the live URL when no distinct staging domain is configured", () => {
    const urls = buildBlogUrls("post-slug", {
      siteBaseUrl: "https://sippy.life",
      stagingBaseUrl: null,
      blogPathPrefix: "/blog",
    });
    expect(urls.stagingUrl).toBe(urls.liveUrl);
    expect(urls.liveUrl).toBe("https://sippy.life/blog/post-slug");
  });

  it("returns a null live URL when the tenant has no site domain configured", () => {
    const urls = buildBlogUrls("post-slug", {
      siteBaseUrl: null,
      stagingBaseUrl: "https://gamma.gruve.events",
      blogPathPrefix: "/blog",
    });
    expect(urls.liveUrl).toBeNull();
    expect(urls.stagingUrl).toBe("https://gamma.gruve.events/blog/post-slug");
  });
});
