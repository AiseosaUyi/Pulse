import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isScraperApiConfigured,
  fetchRenderedHtml,
} from "@/lib/scrape/scraping-api";

describe("scraping-api — unconfigured", () => {
  beforeEach(() => {
    vi.stubEnv("SCRAPERAPI_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not configured", () => {
    expect(isScraperApiConfigured()).toBe(false);
  });

  it("returns null (not a throw) instead of making a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await fetchRenderedHtml("https://example.com/");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("scraping-api — configured", () => {
  beforeEach(() => {
    vi.stubEnv("SCRAPERAPI_KEY", "test-key-123");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports configured", () => {
    expect(isScraperApiConfigured()).toBe(true);
  });

  it("requests the target URL through the ScraperAPI endpoint with render=true", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>rendered</html>", { status: 200 }));

    const result = await fetchRenderedHtml("https://tixtango.com/");
    expect(result).toEqual({ html: "<html>rendered</html>", finalUrl: "https://tixtango.com/" });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://api.scraperapi.com/");
    expect(calledUrl.searchParams.get("api_key")).toBe("test-key-123");
    expect(calledUrl.searchParams.get("url")).toBe("https://tixtango.com/");
    expect(calledUrl.searchParams.get("render")).toBe("true");
  });

  it("returns null on a non-ok response rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const result = await fetchRenderedHtml("https://tixtango.com/");
    expect(result).toBeNull();
  });
});
