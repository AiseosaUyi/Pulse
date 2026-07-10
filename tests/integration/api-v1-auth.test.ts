import { describe, it, expect, beforeAll } from "vitest";

// Shallow integration test for the /api/v1 auth gate — mirrors
// tests/integration/cron-routes.test.ts: call route handlers directly
// (no HTTP server, no live DB) with a forged Request, and assert the
// auth-gate rejection paths. A garbage/missing bearer never reaches
// the DB (resolveApiToken short-circuits on the pulse_ext_ prefix
// check), so these cases are safe to test without seeded data.
// Wrong-scope (403) and the happy path need a real token, covered in
// tests/integration/api-v1-sales.test.ts instead.

let meHandler: typeof import("../../src/app/api/v1/me/route").GET;
let prospectsHandler: typeof import("../../src/app/api/v1/prospects/route").GET;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "stub-service";

  meHandler = (await import("../../src/app/api/v1/me/route")).GET;
  prospectsHandler = (await import("../../src/app/api/v1/prospects/route")).GET;
});

function makeRequest(url: string, headers: Record<string, string>): Request {
  return new Request(url, { headers });
}

describe("/api/v1 auth gate", () => {
  it.each([
    ["/api/v1/me", () => meHandler],
    ["/api/v1/prospects", () => prospectsHandler],
  ])("%s rejects a missing bearer", async (path, getHandler) => {
    const res = await getHandler()(makeRequest(`https://test.local${path}`, {}));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it.each([
    ["/api/v1/me", () => meHandler],
    ["/api/v1/prospects", () => prospectsHandler],
  ])("%s rejects a malformed bearer", async (path, getHandler) => {
    const res = await getHandler()(
      makeRequest(`https://test.local${path}`, { authorization: "Bearer not-a-real-token" })
    );
    expect(res.status).toBe(401);
  });

  it("responds to OPTIONS with CORS headers and no auth required", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/me/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
