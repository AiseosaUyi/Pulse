import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";
import { mintApprovalToken } from "../../src/lib/approvals/token";

// Real-DB integration test for the Notifications/mobile-approvals group.
// Approval requests are seeded directly (bypassing createApprovalRequest's
// delivery step) so these tests never trigger a real Brevo/WhatsApp send —
// same real-external-call exclusion as the AI-writing routes elsewhere in
// this suite. The approve/reject routes' own JWT-verify + state-transition
// logic is exercised end to end.

const TENANT = `api-v1-appr-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-appr-ghost-${Math.random().toString(36).slice(2, 8)}`;

let readToken: string;
let writeToken: string;

let scheduledPostId: string;
let dueScheduledPostId: string;
let briefId: string;

async function mintApiToken(tenantSlug: string, scope: string): Promise<string> {
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

async function seedApprovalRequest(
  tenantSlug: string,
  targetType: "scheduled_post" | "content_brief",
  targetId: string,
  opts: { expired?: boolean } = {}
): Promise<{ requestId: string; token: string }> {
  const expiresAt = new Date(Date.now() + (opts.expired ? -1000 : 72 * 60 * 60 * 1000)).toISOString();
  const { data, error } = await admin
    .from("approval_requests")
    .insert({
      tenant_slug: tenantSlug,
      target_type: targetType,
      target_id: targetId,
      delivered_via: "email",
      delivered_to: "founder@example.com",
      token_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seed insert failed");
  const token = await mintApprovalToken(data.id);
  return { requestId: data.id, token };
}

beforeAll(async () => {
  const { error: tErr } = await admin
    .from("tenants")
    .insert([{ slug: TENANT, name: "API v1 Approvals Test" }, { slug: GHOST, name: "API v1 Approvals Ghost" }]);
  if (tErr) throw tErr;

  readToken = await mintApiToken(TENANT, "content:read");
  writeToken = await mintApiToken(TENANT, "publish:write,content:write");

  const { data: post, error: postErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: TENANT,
      platform: "linkedin",
      content: "original draft caption",
      scheduled_for: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      status: "draft",
    })
    .select("id")
    .single();
  if (postErr || !post) throw postErr;
  scheduledPostId = post.id;

  const { data: duePost, error: dueErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: TENANT,
      platform: "linkedin",
      content: "due draft caption",
      scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      status: "draft",
    })
    .select("id")
    .single();
  if (dueErr || !duePost) throw dueErr;
  dueScheduledPostId = duePost.id;

  const { data: brief, error: briefErr } = await admin
    .from("content_briefs")
    .insert({ tenant_id: TENANT, platform: "instagram", content_type: "reel", title: "Brief title", draft_content: "original brief draft" })
    .select("id")
    .single();
  if (briefErr || !brief) throw briefErr;
  briefId = brief.id;
});

afterAll(async () => {
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

function authedReq(url: string, token: string, init?: RequestInit): Request {
  return new Request(url, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } });
}

describe("/api/v1 notifications / approvals group", () => {
  it("POST /briefings/send 404s on a nonexistent target", async () => {
    const { POST } = await import("../../src/app/api/v1/briefings/send/route");
    const res = await POST(
      authedReq("https://test.local/api/v1/briefings/send", writeToken, {
        method: "POST",
        body: JSON.stringify({
          targetType: "scheduled_post",
          targetId: "00000000-0000-0000-0000-000000000000",
          deliveredVia: "email",
          deliveredTo: "founder@example.com",
        }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("POST /briefings/send with the wrong scope is rejected (403), never reaching delivery", async () => {
    const { POST } = await import("../../src/app/api/v1/briefings/send/route");
    const res = await POST(
      authedReq("https://test.local/api/v1/briefings/send", readToken, {
        method: "POST",
        body: JSON.stringify({
          targetType: "scheduled_post",
          targetId: scheduledPostId,
          deliveredVia: "email",
          deliveredTo: "founder@example.com",
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /briefings/send rejects an invalid body (400)", async () => {
    const { POST } = await import("../../src/app/api/v1/briefings/send/route");
    const res = await POST(
      authedReq("https://test.local/api/v1/briefings/send", writeToken, {
        method: "POST",
        body: JSON.stringify({ targetType: "not-a-real-type" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /approvals/pending only returns the token's own tenant", async () => {
    const { requestId } = await seedApprovalRequest(TENANT, "scheduled_post", scheduledPostId);
    const { GET } = await import("../../src/app/api/v1/approvals/pending/route");
    const res = await GET(authedReq("https://test.local/api/v1/approvals/pending", readToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(requestId);
  });

  it("POST /approvals/:token/approve on an invalid token is rejected (401)", async () => {
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/approve/route");
    const res = await POST(req("https://test.local/api/v1/approvals/garbage/approve", { method: "POST" }), {
      params: Promise.resolve({ token: "not-a-real-jwt" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /approvals/:token/approve on an expired token is rejected (410)", async () => {
    const { token } = await seedApprovalRequest(TENANT, "scheduled_post", scheduledPostId, { expired: true });
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/approve/route");
    const res = await POST(req(`https://test.local/api/v1/approvals/${token}/approve`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(410);
  });

  it("approving a draft scheduled_post promotes it to scheduled (auto-publish gate)", async () => {
    const { token } = await seedApprovalRequest(TENANT, "scheduled_post", scheduledPostId);
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/approve/route");
    const res = await POST(
      req(`https://test.local/api/v1/approvals/${token}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ token }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin.from("scheduled_posts").select("status").eq("id", scheduledPostId).single();
    expect(data?.status).toBe("scheduled");
  });

  it("approving with editedContent persists the edit before promoting", async () => {
    const { token } = await seedApprovalRequest(TENANT, "scheduled_post", dueScheduledPostId);
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/approve/route");
    const res = await POST(
      req(`https://test.local/api/v1/approvals/${token}/approve`, {
        method: "POST",
        body: JSON.stringify({ editedContent: "edited caption text" }),
      }),
      { params: Promise.resolve({ token }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("scheduled_posts")
      .select("status, content")
      .eq("id", dueScheduledPostId)
      .single();
    expect(data?.content).toBe("edited caption text");
    expect(data?.status).toBe("scheduled");
  });

  it("a second approve on the same request is rejected (409, one-time-use)", async () => {
    const { requestId } = await seedApprovalRequest(TENANT, "scheduled_post", scheduledPostId);
    const token = await mintApprovalToken(requestId);
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/approve/route");

    const first = await POST(req(`https://test.local/api/v1/approvals/${token}/approve`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
    expect(first.status).toBe(200);

    const second = await POST(req(`https://test.local/api/v1/approvals/${token}/approve`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
    expect(second.status).toBe(409);
  });

  it("rejecting a scheduled_post marks it failed with the reason in error_message", async () => {
    const { token } = await seedApprovalRequest(TENANT, "scheduled_post", scheduledPostId);
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/reject/route");
    const res = await POST(
      req(`https://test.local/api/v1/approvals/${token}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "wrong tone" }),
      }),
      { params: Promise.resolve({ token }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("scheduled_posts")
      .select("status, error_message")
      .eq("id", scheduledPostId)
      .single();
    expect(data?.status).toBe("failed");
    expect(data?.error_message).toContain("wrong tone");
  });

  it("approving a content_brief transitions it to approved", async () => {
    const { token } = await seedApprovalRequest(TENANT, "content_brief", briefId);
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/approve/route");
    const res = await POST(req(`https://test.local/api/v1/approvals/${token}/approve`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(200);

    const { data } = await admin.from("content_briefs").select("status").eq("id", briefId).single();
    expect(data?.status).toBe("approved");
  });

  it("rejecting a content_brief dismisses it with the reason", async () => {
    const { data: brief2 } = await admin
      .from("content_briefs")
      .insert({ tenant_id: TENANT, platform: "instagram", content_type: "reel", title: "Second brief", draft_content: "draft 2" })
      .select("id")
      .single();
    const { token } = await seedApprovalRequest(TENANT, "content_brief", brief2!.id);
    const { POST } = await import("../../src/app/api/v1/approvals/[token]/reject/route");
    const res = await POST(
      req(`https://test.local/api/v1/approvals/${token}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "not relevant" }),
      }),
      { params: Promise.resolve({ token }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("content_briefs")
      .select("status, dismissed_reason")
      .eq("id", brief2!.id)
      .single();
    expect(data?.status).toBe("dismissed");
    expect(data?.dismissed_reason).toBe("not relevant");
  });

  it("OPTIONS /briefings/send returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/briefings/send/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
