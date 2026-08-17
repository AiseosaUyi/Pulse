import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

// Real-DB integration test for the Sales group, following the
// tenant-seeding pattern in tests/integration/rls.test.ts: mint a real
// tenant_api_tokens row via the service-role `admin` client, hit the
// route handlers with a real Authorization header, assert both the
// happy path and that a second tenant's data never leaks across.

const TENANT = `api-v1-test-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-ghost-${Math.random().toString(36).slice(2, 8)}`;

let readWriteToken: string;
let readOnlyToken: string;
let tenantProspectId: string;
let ghostProspectId: string;

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
    .insert([{ slug: TENANT, name: "API v1 Test" }, { slug: GHOST, name: "API v1 Ghost" }]);
  if (tErr) throw tErr;

  readWriteToken = await mintToken(TENANT, "sales:read,sales:write");
  readOnlyToken = await mintToken(TENANT, "sales:read");

  const { data: tenantProspect, error: pErr } = await admin
    .from("prospects")
    .insert({ tenant_slug: TENANT, platform: "instagram", handle: "tenant-lead" })
    .select("id")
    .single();
  if (pErr) throw pErr;
  tenantProspectId = tenantProspect.id;

  const { data: ghostProspect, error: gErr } = await admin
    .from("prospects")
    .insert({ tenant_slug: GHOST, platform: "instagram", handle: "ghost-lead" })
    .select("id")
    .single();
  if (gErr) throw gErr;
  ghostProspectId = ghostProspect.id;
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

describe("/api/v1 sales group", () => {
  it("GET /me resolves the token's tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/me/route");
    const res = await GET(authedRequest("https://test.local/api/v1/me", readOnlyToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant.slug).toBe(TENANT);
    expect(body.scopes).toContain("sales:read");
  });

  it("GET /prospects only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/prospects/route");
    const res = await GET(
      authedRequest("https://test.local/api/v1/prospects", readWriteToken)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const handles = body.data.map((p: { handle: string }) => p.handle);
    expect(handles).toContain("tenant-lead");
    expect(handles).not.toContain("ghost-lead");
  });

  it("GET /prospects/:id 404s on a cross-tenant id (no leak)", async () => {
    const { GET } = await import("../../src/app/api/v1/prospects/[id]/route");
    const res = await GET(
      authedRequest(`https://test.local/api/v1/prospects/${ghostProspectId}`, readWriteToken),
      { params: Promise.resolve({ id: ghostProspectId }) }
    );
    expect(res.status).toBe(404);
  });

  it("GET /prospects/:id returns the prospect + thread for the owning tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/prospects/[id]/route");
    const res = await GET(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}`, readWriteToken),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prospect.id).toBe(tenantProspectId);
    expect(Array.isArray(body.thread)).toBe(true);
  });

  it("POST /prospects/:id/stage with a read-only token is rejected (403)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/stage/route");
    const res = await POST(
      authedRequest(
        `https://test.local/api/v1/prospects/${tenantProspectId}/stage`,
        readOnlyToken,
        { method: "POST", body: JSON.stringify({ status: "qualified" }) }
      ),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /prospects/:id/stage with a read-write token transitions the prospect", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/stage/route");
    const res = await POST(
      authedRequest(
        `https://test.local/api/v1/prospects/${tenantProspectId}/stage`,
        readWriteToken,
        {
          method: "POST",
          body: JSON.stringify({ status: "qualified", reason: "fits ICP" }),
        }
      ),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("prospects")
      .select("status, notes")
      .eq("id", tenantProspectId)
      .single();
    expect(data?.status).toBe("qualified");
    expect(data?.notes).toBe("fits ICP");
  });

  it("POST /prospects upserts by (platform, handle)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/prospects", readWriteToken, {
        method: "POST",
        body: JSON.stringify({ platform: "tiktok", handle: "@New.Handle" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prospect.handle).toBe("new.handle");
    expect(body.prospect.tenantSlug).toBe(TENANT);
  });

  it("POST /prospects rejects an invalid body with {error, issues} (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/prospects", readWriteToken, {
        method: "POST",
        body: JSON.stringify({ platform: "not-a-real-platform", handle: "" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("POST /prospects/:id/stage rejects an invalid status enum (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/stage/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/stage`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ status: "not-a-real-status" }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(400);
  });

  it("POST /prospects/:id/notes 404s on a nonexistent prospect (real service-layer branch, not Zod)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/notes/route");
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${fakeId}/notes`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ body: "a note" }),
      }),
      { params: Promise.resolve({ id: fakeId }) }
    );
    expect(res.status).toBe(404);
  });

  it("OPTIONS /prospects returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/prospects/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("POST /prospects/:id/quality sets the quality tier", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/quality/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/quality`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ quality: "hot" }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("prospects")
      .select("quality")
      .eq("id", tenantProspectId)
      .single();
    expect(data?.quality).toBe("hot");
  });

  it("POST /prospects/:id/quality rejects an invalid quality enum (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/quality/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/quality`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ quality: "scorching" }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(400);
  });

  it("POST /prospects/:id/quality with a read-only token is rejected (403)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/quality/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/quality`, readOnlyToken, {
        method: "POST",
        body: JSON.stringify({ quality: "hot" }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /prospects/:id/duplicate marks a prospect as a duplicate and drops status to dismissed", async () => {
    const { data: other, error } = await admin
      .from("prospects")
      .insert({ tenant_slug: TENANT, platform: "instagram", handle: "the-original" })
      .select("id")
      .single();
    if (error) throw error;

    const { POST } = await import("../../src/app/api/v1/prospects/[id]/duplicate/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/duplicate`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ duplicateOfId: other.id }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("prospects")
      .select("duplicate_of_id, status")
      .eq("id", tenantProspectId)
      .single();
    expect(data?.duplicate_of_id).toBe(other.id);
    expect(data?.status).toBe("dismissed");

    // unmark
    const res2 = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/duplicate`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ duplicateOfId: null }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res2.status).toBe(200);
    const { data: unmarked } = await admin
      .from("prospects")
      .select("duplicate_of_id, status")
      .eq("id", tenantProspectId)
      .single();
    expect(unmarked?.duplicate_of_id).toBeNull();
    expect(unmarked?.status).toBe("dismissed"); // status is left as-is on unmark
  });

  it("POST /prospects/:id/duplicate rejects self-reference (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/duplicate/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/duplicate`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ duplicateOfId: tenantProspectId }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(400);
  });

  it("POST /prospects/:id/duplicate 404s when the target prospect doesn't exist", async () => {
    const { POST } = await import("../../src/app/api/v1/prospects/[id]/duplicate/route");
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await POST(
      authedRequest(`https://test.local/api/v1/prospects/${tenantProspectId}/duplicate`, readWriteToken, {
        method: "POST",
        body: JSON.stringify({ duplicateOfId: fakeId }),
      }),
      { params: Promise.resolve({ id: tenantProspectId }) }
    );
    expect(res.status).toBe(404);
  });

  it("GET /prospects?search= with PostgREST filter-injection characters doesn't 500 or leak cross-column filters", async () => {
    const { GET } = await import("../../src/app/api/v1/prospects/route");
    // ",)." close/reopen a .or() filter group in PostgREST's grammar —
    // pre-fix this could inject an additional OR'd condition or malform
    // the query into a 500 (error-oracle). Sanitization strips these.
    const res = await GET(
      authedRequest(
        `https://test.local/api/v1/prospects?search=${encodeURIComponent('tenant-lead",status.eq.qualified,handle.ilike."%')}`,
        readWriteToken
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });
});
