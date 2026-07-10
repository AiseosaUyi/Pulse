import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

// Real-DB integration test for the Intelligence group, mirroring the
// tenant-seeding + ghost-tenant-isolation pattern in api-v1-sales.test.ts.
// competitors/intel_cards use a plain `tenant_id` text column (no FK, no
// per-tenant RLS — see 001_intelligence_feed.sql), so isolation is
// entirely enforced by the service layer's .eq("tenant_id", ...) filter;
// these tests exist specifically to prove that filter holds under token
// auth (no session, no RLS backstop).

const TENANT = `api-v1-intel-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-intel-ghost-${Math.random().toString(36).slice(2, 8)}`;

let readToken: string;
let noScopeToken: string;

async function mintToken(tenantSlug: string, scope: string): Promise<string> {
  const raw = generateToken();
  const { error } = await admin.from("tenant_api_tokens").insert({
    tenant_slug: tenantSlug,
    name: `test-${scope}`,
    token_hash: hashToken(raw),
    token_prefix: raw.slice(0, 14),
    token_last4: raw.slice(-4),
    scope,
  });
  if (error) throw error;
  return raw;
}

beforeAll(async () => {
  const { error: tErr } = await admin
    .from("tenants")
    .insert([{ slug: TENANT, name: "API v1 Intel Test" }, { slug: GHOST, name: "API v1 Intel Ghost" }]);
  if (tErr) throw tErr;

  readToken = await mintToken(TENANT, "intel:read");
  noScopeToken = await mintToken(TENANT, "sales:read");

  const { error: compErr } = await admin.from("competitors").insert([
    { tenant_id: TENANT, name: "Tenant Rival", type: "direct" },
    { tenant_id: GHOST, name: "Ghost Rival", type: "direct" },
  ]);
  if (compErr) throw compErr;

  const { error: cardErr } = await admin.from("intel_cards").insert([
    {
      tenant_id: TENANT,
      competitor_name: "Tenant Rival",
      competitor_type: "direct",
      platform: "instagram",
      content_type: "reel",
      summary: "tenant signal",
    },
    {
      tenant_id: GHOST,
      competitor_name: "Ghost Rival",
      competitor_type: "direct",
      platform: "instagram",
      content_type: "reel",
      summary: "ghost signal",
    },
  ]);
  if (cardErr) throw cardErr;

  const { error: trendErr } = await admin.from("trend_scouts").insert([
    { tenant_slug: TENANT, platform: "tiktok", source: "manual", summary: "tenant trend" },
    { tenant_slug: GHOST, platform: "tiktok", source: "manual", summary: "ghost trend" },
  ]);
  if (trendErr) throw trendErr;
});

afterAll(async () => {
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function authedRequest(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

describe("/api/v1 intel group", () => {
  it("GET /intel/feed only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/intel/feed/route");
    const res = await GET(authedRequest("https://test.local/api/v1/intel/feed", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const summaries = body.data.map((c: { summary: string }) => c.summary);
    expect(summaries).toContain("tenant signal");
    expect(summaries).not.toContain("ghost signal");
  });

  it("GET /intel/feed with the wrong scope is rejected (403)", async () => {
    const { GET } = await import("../../src/app/api/v1/intel/feed/route");
    const res = await GET(authedRequest("https://test.local/api/v1/intel/feed", noScopeToken));
    expect(res.status).toBe(403);
  });

  it("GET /competitors only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/competitors/route");
    const res = await GET(authedRequest("https://test.local/api/v1/competitors", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((c: { name: string }) => c.name);
    expect(names).toContain("Tenant Rival");
    expect(names).not.toContain("Ghost Rival");
  });

  it("GET /trends only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/trends/route");
    const res = await GET(authedRequest("https://test.local/api/v1/trends", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const summaries = body.data.map((t: { summary: string }) => t.summary);
    expect(summaries).toContain("tenant trend");
    expect(summaries).not.toContain("ghost trend");
  });

  it("GET /trends rejects an invalid platform filter (400)", async () => {
    const { GET } = await import("../../src/app/api/v1/trends/route");
    const res = await GET(
      authedRequest("https://test.local/api/v1/trends?platform=not-a-real-platform", readToken)
    );
    expect(res.status).toBe(400);
  });

  it("OPTIONS /intel/feed returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/intel/feed/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
