import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

const TENANT = `api-v1-an-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-an-ghost-${Math.random().toString(36).slice(2, 8)}`;

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
    .insert([{ slug: TENANT, name: "API v1 Analytics Test" }, { slug: GHOST, name: "API v1 Analytics Ghost" }]);
  if (tErr) throw tErr;

  readToken = await mintToken(TENANT, "analytics:read");
  noScopeToken = await mintToken(TENANT, "sales:read");

  const { error: metricsErr } = await admin.from("own_post_metrics").insert([
    { tenant_slug: TENANT, platform: "instagram", source: "manual", caption: "tenant post", metrics: { views: 100 } },
    { tenant_slug: GHOST, platform: "instagram", source: "manual", caption: "ghost post", metrics: { views: 100 } },
  ]);
  if (metricsErr) throw metricsErr;

  const { error: digestErr } = await admin.from("weekly_digests").insert({
    tenant_slug: TENANT,
    week_of: "2026-07-04",
    narrative: "tenant weekly brief",
  });
  if (digestErr) throw digestErr;
});

afterAll(async () => {
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function authedRequest(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

describe("/api/v1 analytics group", () => {
  it("GET /analytics/overview resolves the token's own tenant KPIs", async () => {
    const { GET } = await import("../../src/app/api/v1/analytics/overview/route");
    const res = await GET(authedRequest("https://test.local/api/v1/analytics/overview", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.socialReach).toBeDefined();
  });

  it("GET /analytics/overview with the wrong scope is rejected (403)", async () => {
    const { GET } = await import("../../src/app/api/v1/analytics/overview/route");
    const res = await GET(authedRequest("https://test.local/api/v1/analytics/overview", noScopeToken));
    expect(res.status).toBe(403);
  });

  it("GET /analytics/posts only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/analytics/posts/route");
    const res = await GET(authedRequest("https://test.local/api/v1/analytics/posts", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const captions = body.data.map((p: { caption: string }) => p.caption);
    expect(captions).toContain("tenant post");
    expect(captions).not.toContain("ghost post");
  });

  it("GET /analytics/posts rejects an invalid platform filter (400)", async () => {
    const { GET } = await import("../../src/app/api/v1/analytics/posts/route");
    const res = await GET(
      authedRequest("https://test.local/api/v1/analytics/posts?platform=not-a-real-platform", readToken)
    );
    expect(res.status).toBe(400);
  });

  it("GET /weekly-review returns the token's latest digest", async () => {
    const { GET } = await import("../../src/app/api/v1/weekly-review/route");
    const res = await GET(authedRequest("https://test.local/api/v1/weekly-review", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.narrative).toBe("tenant weekly brief");
  });

  it("GET /weekly-review 404s for a tenant with no digest", async () => {
    const ghostToken = await mintToken(GHOST, "analytics:read");
    const { GET } = await import("../../src/app/api/v1/weekly-review/route");
    const res = await GET(authedRequest("https://test.local/api/v1/weekly-review", ghostToken));
    expect(res.status).toBe(404);
  });

  it("OPTIONS /analytics/overview returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/analytics/overview/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
