import { describe, it, expect } from "vitest";
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
});
