import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Instagram reels now come back from cobalt as a cover JPG, so Pulse resolves
// Instagram through a small yt-dlp service. These tests pin the adapter's
// contract with that service (services/ytdlp-resolver).

const { resolveInstagramViaYtdlp, openInstagramDownload, isYtdlpConfigured } =
  await import("@/lib/scrape/ytdlp-resolver");

const URL_IG = "https://www.instagram.com/reel/DdroLq5g5Bk/";

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ytdlp adapter", () => {
  beforeEach(() => {
    process.env.YTDLP_API_URL = "https://fake-ytdlp.test";
    process.env.YTDLP_API_KEY = "secret-key-123";
  });
  afterEach(() => {
    delete process.env.YTDLP_API_URL;
    delete process.env.YTDLP_API_KEY;
    vi.unstubAllGlobals();
  });

  it("maps a successful /resolve and sends the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes(200, { ok: true, kind: "video", title: "T", duration: 11, uploader: "u", thumbnail: "x" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveInstagramViaYtdlp(URL_IG)).resolves.toEqual({
      title: "T",
      durationSec: 11,
      uploader: "u",
      thumbnail: "x",
    });
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://fake-ytdlp.test/resolve");
    expect(init.headers.Authorization).toBe("Bearer secret-key-123");
  });

  it.each([
    [422, { ok: false, error: "no_video" }, "no_video"],
    [429, { ok: false, error: "busy" }, "busy"],
    [401, { error: "unauthorized" }, "auth_required"],
  ])("maps HTTP %i to status %s", async (status, body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(status, body)));
    await expect(resolveInstagramViaYtdlp(URL_IG)).rejects.toMatchObject({ status: expected });
  });

  it("is not configured without env and never leaks the key in errors", async () => {
    delete process.env.YTDLP_API_KEY;
    expect(isYtdlpConfigured()).toBe(false);
    await expect(resolveInstagramViaYtdlp(URL_IG)).rejects.toMatchObject({ status: "not_configured" });

    process.env.YTDLP_API_KEY = "secret-key-123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(502, { ok: false, error: "boom" })));
    const err = await resolveInstagramViaYtdlp(URL_IG).catch((e) => e);
    expect(String(err.message)).not.toContain("secret-key-123");
  });

  it("openInstagramDownload leaves the video body unread on success", async () => {
    const res = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    const out = await openInstagramDownload(URL_IG);
    expect(out.bodyUsed).toBe(false);
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("openInstagramDownload maps error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(422, { ok: false, error: "no_video" })));
    await expect(openInstagramDownload(URL_IG)).rejects.toMatchObject({ status: "no_video" });
  });
});
