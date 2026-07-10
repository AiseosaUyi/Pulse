import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

// Real-DB integration test for the Publishing + Engagement groups,
// same pattern as tests/integration/api-v1-sales.test.ts. AI-calling
// endpoints (POST /inbox/:id/reply-draft's happy path) are
// deliberately not exercised here — same boundary PR1 drew around
// POST /prospects/:id/draft-dm — only the free, non-AI-calling paths
// (auth, validation, tenant isolation, 404 guards) are covered.

const TENANT = `api-v1-pe-test-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-pe-ghost-${Math.random().toString(36).slice(2, 8)}`;

let token: string;
let tenantPostId: string;
let ghostPostId: string;
let tenantYoutubePostId: string;
let tenantInboxId: string;
let ghostInboxId: string;

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
    .insert([{ slug: TENANT, name: "API v1 P/E Test" }, { slug: GHOST, name: "API v1 P/E Ghost" }]);
  if (tErr) throw tErr;

  token = await mintToken(TENANT, "publish:read,publish:write,engage:read,engage:write");

  const { data: tenantPost, error: pErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: TENANT,
      platform: "instagram",
      content: "Test post",
      media_paths: ["assets/" + TENANT + "/202607/test.jpg"],
      scheduled_for: new Date().toISOString(),
      status: "scheduled",
    })
    .select("id")
    .single();
  if (pErr) throw pErr;
  tenantPostId = tenantPost.id;

  const { data: ghostPost, error: gpErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: GHOST,
      platform: "instagram",
      content: "Ghost post",
      scheduled_for: new Date().toISOString(),
      status: "scheduled",
    })
    .select("id")
    .single();
  if (gpErr) throw gpErr;
  ghostPostId = ghostPost.id;

  const { data: youtubePost, error: ypErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: TENANT,
      platform: "youtube",
      content: "Test YouTube post",
      scheduled_for: new Date().toISOString(),
      status: "scheduled",
    })
    .select("id")
    .single();
  if (ypErr) throw ypErr;
  tenantYoutubePostId = youtubePost.id;

  const { data: tenantItem, error: iErr } = await admin
    .from("engagement_items")
    .insert({
      tenant_slug: TENANT,
      type: "comment",
      platform: "instagram",
      from_name: "Test User",
      content: "Nice post!",
    })
    .select("id")
    .single();
  if (iErr) throw iErr;
  tenantInboxId = tenantItem.id;

  const { data: ghostItem, error: giErr } = await admin
    .from("engagement_items")
    .insert({
      tenant_slug: GHOST,
      type: "comment",
      platform: "instagram",
      from_name: "Ghost User",
      content: "Ghost comment",
    })
    .select("id")
    .single();
  if (giErr) throw giErr;
  ghostInboxId = ghostItem.id;
});

afterAll(async () => {
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function authedRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  });
}

describe("/api/v1 publishing group", () => {
  it("GET /publish-queue only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/publish-queue/route");
    const res = await GET(authedRequest("https://test.local/api/v1/publish-queue"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(tenantPostId);
    expect(ids).not.toContain(ghostPostId);
    const own = body.data.find((p: { id: string }) => p.id === tenantPostId);
    expect(own.mediaPaths).toEqual(["assets/" + TENANT + "/202607/test.jpg"]);
  });

  it("GET /media/:path rejects a key belonging to another tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/media/[...path]/route");
    const path = ["assets", GHOST, "202607", "test.jpg"];
    const res = await GET(
      authedRequest(`https://test.local/api/v1/media/${path.join("/")}`),
      { params: Promise.resolve({ path }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /posts/:id/published 404s on a cross-tenant id", async () => {
    const { POST } = await import("../../src/app/api/v1/posts/[id]/published/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/posts/${ghostPostId}/published`, {
        method: "POST",
        body: JSON.stringify({ platformPostId: "abc", platformPostUrl: "https://instagram.com/p/abc" }),
      }),
      { params: Promise.resolve({ id: ghostPostId }) }
    );
    expect(res.status).toBe(404);
  });

  it("POST /posts/:id/published records the post, then rejects a second call (409)", async () => {
    const { POST } = await import("../../src/app/api/v1/posts/[id]/published/route");
    const req = () =>
      authedRequest(`https://test.local/api/v1/posts/${tenantPostId}/published`, {
        method: "POST",
        body: JSON.stringify({ platformPostId: "abc123", platformPostUrl: "https://instagram.com/p/abc123" }),
      });

    const first = await POST(req(), { params: Promise.resolve({ id: tenantPostId }) });
    expect(first.status).toBe(200);

    const { data } = await admin
      .from("scheduled_posts")
      .select("status, platform_post_id, platform_post_url, posted_at")
      .eq("id", tenantPostId)
      .single();
    expect(data?.status).toBe("published");
    expect(data?.platform_post_id).toBe("abc123");
    expect(data?.posted_at).toBeTruthy();

    const second = await POST(req(), { params: Promise.resolve({ id: tenantPostId }) });
    expect(second.status).toBe(409);
  });

  it("POST /posts/:id/metrics upserts own_post_metrics with source=manual", async () => {
    const { POST } = await import("../../src/app/api/v1/posts/[id]/metrics/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/posts/${tenantPostId}/metrics`, {
        method: "POST",
        body: JSON.stringify({ likes: 42, comments: 3, observedAt: new Date().toISOString() }),
      }),
      { params: Promise.resolve({ id: tenantPostId }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("own_post_metrics")
      .select("source, platform, metrics")
      .eq("scheduled_post_id", tenantPostId)
      .eq("platform", "instagram")
      .single();
    expect(data?.source).toBe("manual");
    expect(data?.metrics.likes).toBe(42);
    expect(data?.metrics.comments).toBe(3);
  });

  it("POST /posts/:id/metrics rejects a body with no metrics fields (400, Zod refine)", async () => {
    const { POST } = await import("../../src/app/api/v1/posts/[id]/metrics/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/posts/${tenantPostId}/metrics`, {
        method: "POST",
        body: JSON.stringify({ observedAt: new Date().toISOString() }),
      }),
      { params: Promise.resolve({ id: tenantPostId }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("POST /posts/:id/metrics 400s for an unsupported platform (real service-layer branch, not Zod)", async () => {
    const { POST } = await import("../../src/app/api/v1/posts/[id]/metrics/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/posts/${tenantYoutubePostId}/metrics`, {
        method: "POST",
        body: JSON.stringify({ likes: 10 }),
      }),
      { params: Promise.resolve({ id: tenantYoutubePostId }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/youtube/i);
  });

  it("POST /posts/:id/published rejects a body missing platformPostId (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/posts/[id]/published/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/posts/${tenantYoutubePostId}/published`, {
        method: "POST",
        body: JSON.stringify({ platformPostUrl: "https://youtube.com/watch?v=abc" }),
      }),
      { params: Promise.resolve({ id: tenantYoutubePostId }) }
    );
    expect(res.status).toBe(400);
  });

  it("OPTIONS /publish-queue returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/publish-queue/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("/api/v1 engagement group", () => {
  it("GET /inbox only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/inbox/route");
    const res = await GET(authedRequest("https://test.local/api/v1/inbox"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((i: { id: string }) => i.id);
    expect(ids).toContain(tenantInboxId);
    expect(ids).not.toContain(ghostInboxId);
  });

  it("OPTIONS /inbox returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/inbox/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("POST /inbox/:id/reply-draft 404s on a cross-tenant id (no AI call reached)", async () => {
    const { POST } = await import("../../src/app/api/v1/inbox/[id]/reply-draft/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/inbox/${ghostInboxId}/reply-draft`, { method: "POST" }),
      { params: Promise.resolve({ id: ghostInboxId }) }
    );
    expect(res.status).toBe(404);
  });

  it("POST /inbox/:id/replied marks the item handled, scoped to the tenant", async () => {
    const { POST } = await import("../../src/app/api/v1/inbox/[id]/replied/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/inbox/${tenantInboxId}/replied`, { method: "POST" }),
      { params: Promise.resolve({ id: tenantInboxId }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("engagement_items")
      .select("replied, read")
      .eq("id", tenantInboxId)
      .single();
    expect(data?.replied).toBe(true);
    expect(data?.read).toBe(true);
  });

  it("POST /inbox/:id/replied 404s on a cross-tenant id", async () => {
    const { POST } = await import("../../src/app/api/v1/inbox/[id]/replied/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/inbox/${ghostInboxId}/replied`, { method: "POST" }),
      { params: Promise.resolve({ id: ghostInboxId }) }
    );
    expect(res.status).toBe(404);

    const { data } = await admin
      .from("engagement_items")
      .select("replied")
      .eq("id", ghostInboxId)
      .single();
    expect(data?.replied).toBe(false);
  });
});
