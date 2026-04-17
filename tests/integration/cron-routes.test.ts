import { describe, it, expect, beforeAll } from "vitest";

// Shallow integration test for the cron route handlers — asserts each
// route respects the cron auth gate. We call the handlers directly
// (no HTTP server) with a forged Request, so no tenants are touched
// and no AI calls are made.
//
// These tests deliberately don't cover the happy path end-to-end (that
// needs a real DB + AI mocks, tracked separately). Auth is the cheapest
// regression risk and the biggest security surface, so it gets its own
// fast test.

let scrapeHandler: typeof import("../../src/app/api/cron/scrape-trends/route").POST;
let briefsHandler: typeof import("../../src/app/api/cron/generate-briefs/route").POST;
let digestHandler: typeof import("../../src/app/api/cron/weekly-digest/route").POST;

beforeAll(async () => {
  // Force the gate into production-strict mode for this file.
  // NODE_ENV is typed readonly on Next's process.env typing — assign
  // through a cast so the runtime write still happens.
  (process.env as Record<string, string>).NODE_ENV = "production";
  process.env.CRON_SECRET = "test-cron-secret";
  // Supabase env must be present so module-load doesn't throw.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "stub-service";

  scrapeHandler = (await import("../../src/app/api/cron/scrape-trends/route")).POST;
  briefsHandler = (await import("../../src/app/api/cron/generate-briefs/route")).POST;
  digestHandler = (await import("../../src/app/api/cron/weekly-digest/route")).POST;
});

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://test.local/api/cron/fake", {
    method: "POST",
    headers,
  });
}

describe("cron routes: auth gate", () => {
  it.each([
    ["scrape-trends", () => scrapeHandler],
    ["generate-briefs", () => briefsHandler],
    ["weekly-digest", () => digestHandler],
  ])("%s rejects missing authorization", async (_name, getHandler) => {
    const res = await getHandler()(makeRequest({}));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it.each([
    ["scrape-trends", () => scrapeHandler],
    ["generate-briefs", () => briefsHandler],
    ["weekly-digest", () => digestHandler],
  ])("%s rejects a wrong bearer", async (_name, getHandler) => {
    const res = await getHandler()(
      makeRequest({ authorization: "Bearer not-the-secret" })
    );
    expect(res.status).toBe(401);
  });

  it.each([
    ["scrape-trends", () => scrapeHandler],
    ["generate-briefs", () => briefsHandler],
    ["weekly-digest", () => digestHandler],
  ])(
    "%s rejects a valid bearer WITHOUT x-vercel-cron in production",
    async (_name, getHandler) => {
      const res = await getHandler()(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/vercel/i);
    }
  );
});
