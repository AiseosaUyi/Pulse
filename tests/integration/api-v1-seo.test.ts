import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

const TENANT = `api-v1-seo-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-seo-ghost-${Math.random().toString(36).slice(2, 8)}`;

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
    .insert([{ slug: TENANT, name: "API v1 SEO Test" }, { slug: GHOST, name: "API v1 SEO Ghost" }]);
  if (tErr) throw tErr;

  readToken = await mintToken(TENANT, "seo:read");
  noScopeToken = await mintToken(TENANT, "sales:read");

  const { error: rankErr } = await admin.from("keyword_rankings").insert([
    { tenant_slug: TENANT, keyword: "tenant keyword" },
    { tenant_slug: GHOST, keyword: "ghost keyword" },
  ]);
  if (rankErr) throw rankErr;

  const { error: recErr } = await admin.from("seo_recommendations").insert([
    { tenant_slug: TENANT, type: "title_rewrite", payload: { note: "tenant rec" }, score: 0.8 },
    { tenant_slug: GHOST, type: "title_rewrite", payload: { note: "ghost rec" }, score: 0.8 },
  ]);
  if (recErr) throw recErr;
});

afterAll(async () => {
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function authedRequest(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

describe("/api/v1 seo group", () => {
  it("GET /seo/rank only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/seo/rank/route");
    const res = await GET(authedRequest("https://test.local/api/v1/seo/rank", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const keywords = body.data.map((r: { keyword: string }) => r.keyword);
    expect(keywords).toContain("tenant keyword");
    expect(keywords).not.toContain("ghost keyword");
  });

  it("GET /seo/rank with the wrong scope is rejected (403)", async () => {
    const { GET } = await import("../../src/app/api/v1/seo/rank/route");
    const res = await GET(authedRequest("https://test.local/api/v1/seo/rank", noScopeToken));
    expect(res.status).toBe(403);
  });

  it("GET /seo/recommendations only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/seo/recommendations/route");
    const res = await GET(
      authedRequest("https://test.local/api/v1/seo/recommendations", readToken)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const notes = body.data.map((r: { payload: { note: string } }) => r.payload.note);
    expect(notes).toContain("tenant rec");
    expect(notes).not.toContain("ghost rec");
  });

  it("GET /seo/recommendations rejects an invalid status filter (400)", async () => {
    const { GET } = await import("../../src/app/api/v1/seo/recommendations/route");
    const res = await GET(
      authedRequest("https://test.local/api/v1/seo/recommendations?status=not-a-real-status", readToken)
    );
    expect(res.status).toBe(400);
  });

  it("GET /seo/topical-map 404s when no map has been generated yet", async () => {
    const { GET } = await import("../../src/app/api/v1/seo/topical-map/route");
    const res = await GET(authedRequest("https://test.local/api/v1/seo/topical-map", readToken));
    expect(res.status).toBe(404);
  });

  it("OPTIONS /seo/rank returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/seo/rank/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
