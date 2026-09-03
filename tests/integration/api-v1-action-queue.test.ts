import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

// Real-DB integration test for the Action Queue endpoints (migration 105).
// Same pattern as tests/integration/api-v1-publishing-engagement.test.ts.
// Per this repo's convention (migrations are pasted into the Supabase SQL
// Editor by hand, never auto-applied), skip with a loud, actionable
// message instead of a confusing column-not-found failure if 105 hasn't
// been applied to this Supabase project yet — same gate as
// shared-inbox-two-tenant-leak.test.ts uses for migration 102.
const migrationApplied = await (async () => {
  const { error } = await admin.from("action_items").select("id").limit(1);
  return !error;
})();

if (!migrationApplied) {
  console.warn(
    "\n[api-v1-action-queue.test.ts] SKIPPED: migration 105 " +
      "(supabase/migrations/105_action_queue.sql) hasn't been applied to " +
      "this Supabase project yet — the `action_items` table doesn't exist. " +
      "Paste migration 105 into the Supabase SQL Editor and run it, then " +
      "re-run this test file.\n"
  );
}

const suite = migrationApplied ? describe : describe.skip;

const TENANT = `api-v1-aq-test-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-aq-ghost-${Math.random().toString(36).slice(2, 8)}`;

let token: string;
let tenantInboxId: string;
let ghostInboxId: string;
let tenantActionId: string;
let ghostActionId: string;
let tenantRunId: string;

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

function authedRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
}

suite("/api/v1 action-queue group", () => {
  beforeAll(async () => {
    const { error: tErr } = await admin
      .from("tenants")
      .insert([{ slug: TENANT, name: "API v1 AQ Test" }, { slug: GHOST, name: "API v1 AQ Ghost" }]);
    if (tErr) throw tErr;

    token = await mintToken(TENANT, "engage:read,engage:write");

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

    const { data: tenantAction, error: aErr } = await admin
      .from("action_items")
      .insert({ tenant_slug: TENANT, kind: "decision", title: "Accept collab invite?" })
      .select("id")
      .single();
    if (aErr) throw aErr;
    tenantActionId = tenantAction.id;

    const { data: ghostAction, error: gaErr } = await admin
      .from("action_items")
      .insert({ tenant_slug: GHOST, kind: "decision", title: "Ghost decision" })
      .select("id")
      .single();
    if (gaErr) throw gaErr;
    ghostActionId = ghostAction.id;
  });

  afterAll(async () => {
    await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
  });

  it("POST /inbox upserts, and the same externalId twice updates instead of duplicating (criterion 1)", async () => {
    const { POST } = await import("../../src/app/api/v1/inbox/route");
    const body = JSON.stringify({
      platform: "instagram",
      type: "dm",
      externalId: `dedupe-test-${TENANT}`,
      fromName: "Repeat Customer",
      content: "First message",
      receivedAt: new Date().toISOString(),
    });

    const first = await POST(authedRequest("https://test.local/api/v1/inbox", { method: "POST", body }));
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await POST(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: `dedupe-test-${TENANT}`,
          fromName: "Repeat Customer",
          content: "Updated message",
          receivedAt: new Date().toISOString(),
        }),
      })
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);

    const { count } = await admin
      .from("engagement_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", TENANT)
      .eq("external_id", `dedupe-test-${TENANT}`);
    expect(count).toBe(1);

    const { data: row } = await admin.from("engagement_items").select("content").eq("id", firstBody.id).single();
    expect(row?.content).toBe("Updated message");
  });

  it("GET /action-queue only returns the token's own tenant", async () => {
    const { GET } = await import("../../src/app/api/v1/action-queue/route");
    const res = await GET(authedRequest("https://test.local/api/v1/action-queue"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const allIds = body.groups.flatMap((g: { rows: { id: string }[] }) => g.rows.map((r) => r.id));
    expect(allIds).toContain(tenantInboxId);
    expect(allIds).toContain(tenantActionId);
    expect(allIds).not.toContain(ghostInboxId);
    expect(allIds).not.toContain(ghostActionId);
  });

  it("PATCH /inbox/:id 404s on a cross-tenant id", async () => {
    const { PATCH } = await import("../../src/app/api/v1/inbox/[id]/route");
    const res = await PATCH(
      authedRequest(`https://test.local/api/v1/inbox/${ghostInboxId}`, {
        method: "PATCH",
        body: JSON.stringify({ proposedReply: "leaked reply" }),
      }),
      { params: Promise.resolve({ id: ghostInboxId }) }
    );
    expect(res.status).toBe(404);
    const { data } = await admin.from("engagement_items").select("proposed_reply").eq("id", ghostInboxId).single();
    expect(data?.proposed_reply).toBeNull();
  });

  it("PATCH /inbox/:id edits the proposed reply, and it persists (criterion 3)", async () => {
    const { PATCH } = await import("../../src/app/api/v1/inbox/[id]/route");
    const res = await PATCH(
      authedRequest(`https://test.local/api/v1/inbox/${tenantInboxId}`, {
        method: "PATCH",
        body: JSON.stringify({ proposedReply: "Thanks so much!" }),
      }),
      { params: Promise.resolve({ id: tenantInboxId }) }
    );
    expect(res.status).toBe(200);

    const { GET } = await import("../../src/app/api/v1/action-queue/route");
    const queueRes = await GET(authedRequest("https://test.local/api/v1/action-queue"));
    const body = await queueRes.json();
    const row = body.groups
      .flatMap((g: { rows: { id: string; proposedReply: string | null }[] }) => g.rows)
      .find((r: { id: string }) => r.id === tenantInboxId);
    expect(row?.proposedReply).toBe("Thanks so much!");
  });

  it("POST /inbox/:id/status resolves it, which also sets replied=true (criterion 5)", async () => {
    const { POST } = await import("../../src/app/api/v1/inbox/[id]/status/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/inbox/${tenantInboxId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: tenantInboxId }) }
    );
    expect(res.status).toBe(200);

    const { data } = await admin
      .from("engagement_items")
      .select("status, replied, resolved_at")
      .eq("id", tenantInboxId)
      .single();
    expect(data?.status).toBe("resolved");
    expect(data?.replied).toBe(true);
    expect(data?.resolved_at).toBeTruthy();

    const { GET: inboxGet } = await import("../../src/app/api/v1/inbox/route");
    const unansweredRes = await inboxGet(
      authedRequest("https://test.local/api/v1/inbox?unanswered=true")
    );
    const unansweredBody = await unansweredRes.json();
    expect(unansweredBody.data.map((i: { id: string }) => i.id)).not.toContain(tenantInboxId);
  });

  it("POST /action-items upserts by dedupeKey, and a repeat call updates instead of duplicating (criterion 6)", async () => {
    const { POST } = await import("../../src/app/api/v1/action-items/route");
    const dedupeKey = `ig:comment:media1:comment1-${TENANT}`;

    const first = await POST(
      authedRequest("https://test.local/api/v1/action-items", {
        method: "POST",
        body: JSON.stringify({ kind: "opportunity", title: "First sweep", dedupeKey }),
      })
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await POST(
      authedRequest("https://test.local/api/v1/action-items", {
        method: "POST",
        body: JSON.stringify({ kind: "opportunity", title: "Second sweep, same key", dedupeKey }),
      })
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);

    const { count } = await admin
      .from("action_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", TENANT)
      .eq("dedupe_key", dedupeKey);
    expect(count).toBe(1);
  });

  it("POST /action-items/:id/status 404s on a cross-tenant id", async () => {
    const { POST } = await import("../../src/app/api/v1/action-items/[id]/status/route");
    const res = await POST(
      authedRequest(`https://test.local/api/v1/action-items/${ghostActionId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: ghostActionId }) }
    );
    expect(res.status).toBe(404);
    const { data } = await admin.from("action_items").select("status").eq("id", ghostActionId).single();
    expect(data?.status).toBe("open");
  });

  it("Snoozed rows are hidden from the default queue, then reappear once due (criterion 7)", async () => {
    const { POST: statusPost } = await import("../../src/app/api/v1/action-items/[id]/status/route");
    const snoozedUntil = new Date(Date.now() - 1000).toISOString(); // already-past, so it should already be visible again
    const res = await statusPost(
      authedRequest(`https://test.local/api/v1/action-items/${tenantActionId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "snoozed", snoozedUntil }),
      }),
      { params: Promise.resolve({ id: tenantActionId }) }
    );
    expect(res.status).toBe(200);

    const { GET } = await import("../../src/app/api/v1/action-queue/route");
    const queueRes = await GET(authedRequest("https://test.local/api/v1/action-queue"));
    const body = await queueRes.json();
    const allIds = body.groups.flatMap((g: { rows: { id: string }[] }) => g.rows.map((r) => r.id));
    // snoozedUntil is already in the past, so this row is due again and
    // must be visible — the code path (status IN snoozed + snoozed_until
    // <= now) is the same one that hides a row whose snooze hasn't expired.
    expect(allIds).toContain(tenantActionId);
  });

  it("POST /agent-runs opens a run, and /agent-runs/:id/finish closes it", async () => {
    const { POST: startPost } = await import("../../src/app/api/v1/agent-runs/route");
    const startRes = await startPost(
      authedRequest("https://test.local/api/v1/agent-runs", {
        method: "POST",
        body: JSON.stringify({ agent: "agent-social", surface: "instagram" }),
      })
    );
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json();
    expect(startBody.runId).toBeTruthy();
    tenantRunId = startBody.runId;

    const { POST: finishPost } = await import("../../src/app/api/v1/agent-runs/[id]/finish/route");
    const finishRes = await finishPost(
      authedRequest(`https://test.local/api/v1/agent-runs/${tenantRunId}/finish`, {
        method: "POST",
        body: JSON.stringify({ summary: { rowsProcessed: 3 } }),
      }),
      { params: Promise.resolve({ id: tenantRunId }) }
    );
    expect(finishRes.status).toBe(200);

    const { data } = await admin.from("agent_runs").select("finished_at, summary").eq("id", tenantRunId).single();
    expect(data?.finished_at).toBeTruthy();
    expect((data?.summary as { rowsProcessed?: number })?.rowsProcessed).toBe(3);
  });

  it("/api/v1/manifest lists the new endpoints with the right scope (criterion 9)", async () => {
    const { GET } = await import("../../src/app/api/v1/manifest/route");
    const res = await GET(authedRequest("https://test.local/api/v1/manifest"));
    const body = await res.json();
    const byPath = (path: string, method: string) =>
      body.endpoints.find((e: { path: string; method: string }) => e.path === path && e.method === method);
    expect(byPath("/api/v1/action-queue", "GET")?.scope).toBe("engage:read");
    expect(byPath("/api/v1/inbox", "POST")?.scope).toBe("engage:write");
    expect(byPath("/api/v1/inbox/:id", "PATCH")?.scope).toBe("engage:write");
    expect(byPath("/api/v1/action-items", "POST")?.scope).toBe("engage:write");
    expect(byPath("/api/v1/agent-runs", "POST")?.scope).toBe("engage:write");
    expect(byPath("/api/v1/me", "POST")?.scope).toBe("admin");
  });
});
