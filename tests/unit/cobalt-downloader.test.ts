import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression test for a real production bug: cobalt sends its structured
// `{status:"error", error:{code}}` body over HTTP 400 (not 200), but
// resolveViaCobalt()'s `!res.ok` check used to throw a generic
// "cobalt returned HTTP 400" before ever parsing that body — discarding
// the actual, specific reason (e.g. "post is private or deleted") the
// code already knew how to surface. Root-caused via /investigate by
// reproducing against the live cobalt instance with a real failing
// Instagram URL: POST returned exactly
// { status: 400, body: {"status":"error","error":{"code":"error.api.fetch.empty"}} }.

const { resolveViaCobalt, CobaltResolveError } = await import("@/lib/scrape/cobalt-downloader");

describe("resolveViaCobalt", () => {
  beforeEach(() => {
    process.env.COBALT_API_URL = "https://fake-cobalt.test/";
  });

  afterEach(() => {
    delete process.env.COBALT_API_URL;
    vi.unstubAllGlobals();
  });

  it("surfaces the specific error code from a structured error body sent over HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ status: "error", error: { code: "error.api.fetch.empty" } }),
      })
    );

    await expect(resolveViaCobalt("https://www.instagram.com/reel/DL4bo6vIqsk/")).rejects.toMatchObject({
      status: "empty",
    });
  });

  it("still falls back to a generic HTTP-status error for a real infra failure (non-JSON body)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      })
    );

    const err = await resolveViaCobalt("https://www.youtube.com/watch?v=abc").catch((e) => e);
    expect(err).toBeInstanceOf(CobaltResolveError);
    expect(err.status).toBe("upstream_error");
    expect(err.message).toContain("502");
  });

  it("still classifies a 429 as rate_limited when the body isn't cobalt's error shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => {
          throw new SyntaxError("no body");
        },
      })
    );

    await expect(resolveViaCobalt("https://x.com/user/status/1")).rejects.toMatchObject({
      status: "rate_limited",
    });
  });

  it("still resolves a successful tunnel response unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "tunnel", url: "https://cdn.example.com/video.mp4", service: "instagram" }),
      })
    );

    const result = await resolveViaCobalt("https://www.instagram.com/reel/abc/");
    expect(result.mediaUrl).toBe("https://cdn.example.com/video.mp4");
    expect(result.responseStatus).toBe("tunnel");
  });
});
