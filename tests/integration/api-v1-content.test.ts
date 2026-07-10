import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

// Real-DB integration test for the Content group. The AI-writing POST
// routes (/briefs, /blog-posts, /captions/compose) are deliberately NOT
// exercised on the happy path here — same real-LLM-cost exclusion as
// prospects/:id/draft-dm in api-v1-sales.test.ts. Their scope + validation
// branches (403/400) are still covered, since those never reach the LLM.

const TENANT = `api-v1-content-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-content-ghost-${Math.random().toString(36).slice(2, 8)}`;

let readToken: string;
let writeToken: string;
let noScopeToken: string;
let tenantBlogPostId: string;
let ghostBlogPostId: string;

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
    .insert([{ slug: TENANT, name: "API v1 Content Test" }, { slug: GHOST, name: "API v1 Content Ghost" }]);
  if (tErr) throw tErr;

  readToken = await mintToken(TENANT, "content:read");
  writeToken = await mintToken(TENANT, "content:write");
  noScopeToken = await mintToken(TENANT, "sales:read");

  const { error: briefErr } = await admin.from("content_briefs").insert([
    { tenant_id: TENANT, platform: "instagram", content_type: "reel", title: "tenant brief" },
    { tenant_id: GHOST, platform: "instagram", content_type: "reel", title: "ghost brief" },
  ]);
  if (briefErr) throw briefErr;

  const { data: tenantPost, error: postErr } = await admin
    .from("blog_posts")
    .insert({ tenant_slug: TENANT, title: "Tenant Post", content: "tenant content" })
    .select("id")
    .single();
  if (postErr) throw postErr;
  tenantBlogPostId = tenantPost.id;

  const { data: ghostPost, error: ghostErr } = await admin
    .from("blog_posts")
    .insert({ tenant_slug: GHOST, title: "Ghost Post", content: "ghost content" })
    .select("id")
    .single();
  if (ghostErr) throw ghostErr;
  ghostBlogPostId = ghostPost.id;
});

afterAll(async () => {
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function authedRequest(url: string, token: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  });
}

describe("/api/v1 content group", () => {
  it("GET /briefs only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/briefs/route");
    const res = await GET(authedRequest("https://test.local/api/v1/briefs", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = body.data.map((b: { title: string }) => b.title);
    expect(titles).toContain("tenant brief");
    expect(titles).not.toContain("ghost brief");
  });

  it("GET /briefs with the wrong scope is rejected (403)", async () => {
    const { GET } = await import("../../src/app/api/v1/briefs/route");
    const res = await GET(authedRequest("https://test.local/api/v1/briefs", noScopeToken));
    expect(res.status).toBe(403);
  });

  it("POST /briefs 404s on a nonexistent intel card (real service-layer branch, not Zod)", async () => {
    const { POST } = await import("../../src/app/api/v1/briefs/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/briefs", writeToken, {
        method: "POST",
        body: JSON.stringify({ cardId: "00000000-0000-0000-0000-000000000000" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("POST /briefs with a read-only token is rejected (403), never reaching the LLM", async () => {
    const { POST } = await import("../../src/app/api/v1/briefs/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/briefs", readToken, {
        method: "POST",
        body: JSON.stringify({ cardId: "00000000-0000-0000-0000-000000000000" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /content-calendar 404s for a non-allowlisted tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/content-calendar/route");
    const res = await GET(authedRequest("https://test.local/api/v1/content-calendar", readToken));
    expect(res.status).toBe(404);
  });

  it("GET /blog-posts only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/blog-posts/route");
    const res = await GET(authedRequest("https://test.local/api/v1/blog-posts", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = body.data.map((p: { title: string }) => p.title);
    expect(titles).toContain("Tenant Post");
    expect(titles).not.toContain("Ghost Post");
  });

  it("GET /blog-posts rejects an invalid status filter (400)", async () => {
    const { GET } = await import("../../src/app/api/v1/blog-posts/route");
    const res = await GET(
      authedRequest("https://test.local/api/v1/blog-posts?status=not-a-real-status", readToken)
    );
    expect(res.status).toBe(400);
  });

  it("GET /blog-posts/:id 404s on a cross-tenant id (no leak)", async () => {
    const { GET } = await import("../../src/app/api/v1/blog-posts/[id]/route");
    const res = await GET(
      authedRequest(`https://test.local/api/v1/blog-posts/${ghostBlogPostId}`, readToken),
      { params: Promise.resolve({ id: ghostBlogPostId }) }
    );
    expect(res.status).toBe(404);
  });

  it("GET /blog-posts/:id returns the post + latest version for the owning tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/blog-posts/[id]/route");
    const res = await GET(
      authedRequest(`https://test.local/api/v1/blog-posts/${tenantBlogPostId}`, readToken),
      { params: Promise.resolve({ id: tenantBlogPostId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.id).toBe(tenantBlogPostId);
    expect(body.latestVersion).toBeNull();
  });

  it("POST /blog-posts rejects an empty body (title/keyword/context all missing) with {error, issues} (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/blog-posts/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/blog-posts", writeToken, {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Provide a title, a target keyword, or some context — we need something to write about."
    );
  });

  it("POST /blog-posts with a read-only token is rejected (403), never reaching the LLM", async () => {
    const { POST } = await import("../../src/app/api/v1/blog-posts/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/blog-posts", readToken, {
        method: "POST",
        body: JSON.stringify({ title: "Should never be written" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /captions/compose rejects a body with neither sourceUrl nor angle (400), never reaching the LLM", async () => {
    const { POST } = await import("../../src/app/api/v1/captions/compose/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/captions/compose", writeToken, {
        method: "POST",
        body: JSON.stringify({ mode: "original" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /captions/compose with a read-only token is rejected (403), never reaching the LLM", async () => {
    const { POST } = await import("../../src/app/api/v1/captions/compose/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/captions/compose", readToken, {
        method: "POST",
        body: JSON.stringify({ mode: "original", angle: "test angle" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("OPTIONS /blog-posts returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/blog-posts/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
