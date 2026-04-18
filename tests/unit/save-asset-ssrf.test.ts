import { describe, it, expect, afterEach, vi } from "vitest";
import { assertSafeUrl, SaveAssetError } from "@/lib/storage/save-asset";

describe("assertSafeUrl (SSRF guard)", () => {
  it("accepts TikTok CDN URLs", () => {
    expect(() =>
      assertSafeUrl("https://v19.tiktokcdn-us.com/path/to/video.mp4")
    ).not.toThrow();
  });

  it("accepts Instagram CDN URLs", () => {
    expect(() =>
      assertSafeUrl("https://scontent-iad3.cdninstagram.com/v/abc.mp4")
    ).not.toThrow();
  });

  it("accepts Facebook CDN URLs (IG backing)", () => {
    expect(() =>
      assertSafeUrl("https://scontent-lax3-2.xx.fbcdn.net/v/abc.jpg")
    ).not.toThrow();
  });

  it("rejects http:// even on an allowed host", () => {
    expect(() =>
      assertSafeUrl("http://v19.tiktokcdn-us.com/x.mp4")
    ).toThrow(SaveAssetError);
  });

  it("rejects random hosts", () => {
    expect(() => assertSafeUrl("https://example.com/x.mp4")).toThrow(
      /not in CDN allowlist/i
    );
  });

  it("rejects localhost", () => {
    expect(() => assertSafeUrl("https://localhost/secret")).toThrow(
      /localhost rejected|CDN allowlist/i
    );
  });

  it.each([
    "https://127.0.0.1/x",
    "https://10.0.0.1/x",
    "https://192.168.1.1/x",
    "https://172.16.0.1/x",
    "https://169.254.169.254/latest/", // AWS metadata — classic SSRF target
  ])("rejects private IP %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(/Private network/i);
  });

  it("rejects malformed URLs", () => {
    expect(() => assertSafeUrl("not a url")).toThrow(/Invalid URL/);
  });

  it("is case-insensitive on hostname", () => {
    expect(() =>
      assertSafeUrl("https://V19.TikTokCDN-US.COM/x.mp4")
    ).not.toThrow();
  });

  describe("COBALT_API_URL dynamic allowlist", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("accepts the cobalt instance host when COBALT_API_URL is set", () => {
      vi.stubEnv("COBALT_API_URL", "https://pulse-cobalt.onrender.com/");
      expect(() =>
        assertSafeUrl("https://pulse-cobalt.onrender.com/tunnel?id=abc")
      ).not.toThrow();
    });

    it("rejects the same host when COBALT_API_URL is NOT set", () => {
      vi.stubEnv("COBALT_API_URL", "");
      expect(() =>
        assertSafeUrl("https://pulse-cobalt.onrender.com/tunnel?id=abc")
      ).toThrow(/not in CDN allowlist/i);
    });

    it("doesn't open up other onrender.com subdomains", () => {
      vi.stubEnv("COBALT_API_URL", "https://pulse-cobalt.onrender.com/");
      expect(() =>
        assertSafeUrl("https://attacker.onrender.com/payload.mp4")
      ).toThrow(/not in CDN allowlist/i);
    });

    it("ignores malformed COBALT_API_URL without crashing", () => {
      vi.stubEnv("COBALT_API_URL", "not a url");
      expect(() =>
        assertSafeUrl("https://example.com/x.mp4")
      ).toThrow(/not in CDN allowlist/i);
    });
  });
});
