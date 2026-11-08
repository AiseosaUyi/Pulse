import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";
import { repairInconsistentEngagementRows } from "../../src/lib/services/engagement";

// Migration 114 gate
const migrationApplied = await (async () => {
  const { error } = await admin.from("conversation_handoffs").select("id").limit(1);
  return !error;
})();

if (!migrationApplied) {
  console.warn(
    "\n[conversation-handoff.test.ts] SKIPPED: migration 114 " +
      "(supabase/migrations/114_conversation_handoffs_and_engagement_fixes.sql) hasn't been applied to " +
      "this Supabase project yet — the `conversation_handoffs` table doesn't exist.\n"
  );
}

const suite = migrationApplied ? describe : describe.skip;

const TENANT = `handoff-test-${Math.random().toString(36).slice(2, 8)}`;
let token: string;
let testPersonId: string;

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
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
}

suite("Conversation Handoff & Engagement Status Consistency (Migration 114)", () => {
  beforeAll(async () => {
    const { error: tErr } = await admin
      .from("tenants")
      .insert([{ slug: TENANT, name: "Handoff Test Tenant" }]);
    if (tErr) throw tErr;

    token = await mintToken(TENANT, "engage:read,engage:write");

    const { data: person, error: pErr } = await admin
      .from("team_people")
      .insert({
        tenant_slug: TENANT,
        name: "Priye Test",
      })
      .select("id")
      .single();
    if (pErr) throw pErr;
    testPersonId = person.id;
  });

  afterAll(async () => {
    await admin.from("conversation_handoffs").delete().eq("tenant_slug", TENANT);
    await admin.from("engagement_items").delete().eq("tenant_slug", TENANT);
    await admin.from("team_people").delete().eq("tenant_slug", TENANT);
    await admin.from("tenant_api_tokens").delete().eq("tenant_slug", TENANT);
    await admin.from("tenants").delete().eq("slug", TENANT);
  });

  // Acceptance Test 1
  it("1. Upsert DM row, resolve it, re-upsert same externalId with status 'open' -> stays resolved, response has statusIgnored true", async () => {
    const { POST: POST_INBOX } = await import("../../src/app/api/v1/inbox/route");
    const { POST: POST_STATUS } = await import("../../src/app/api/v1/inbox/[id]/status/route");

    const extId = `ig:dm:t1_test1:${Date.now()}_m1`;

    // 1. Initial insert with status open
    const res1 = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: extId,
          fromName: "Alice",
          content: "Initial message",
          receivedAt: new Date().toISOString(),
          status: "open",
        }),
      })
    );
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.statusIgnored).toBe(false);
    const rowId = data1.id;

    // 2. Resolve the row
    const resStatus = await POST_STATUS(
      authedRequest(`https://test.local/api/v1/inbox/${rowId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: rowId }) }
    );
    expect(resStatus.status).toBe(200);

    const { data: rowAfterResolve } = await admin
      .from("engagement_items")
      .select("status, replied, resolved_at")
      .eq("id", rowId)
      .single();
    expect(rowAfterResolve?.status).toBe("resolved");
    expect(rowAfterResolve?.replied).toBe(true);
    expect(rowAfterResolve?.resolved_at).not.toBeNull();

    // 3. Re-upsert same externalId with status 'open'
    const res2 = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: extId,
          fromName: "Alice",
          content: "Repeat upsert message",
          receivedAt: new Date().toISOString(),
          status: "open",
        }),
      })
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.statusIgnored).toBe(true);
    expect(data2.id).toBe(rowId);

    // Verify row stays resolved
    const { data: rowAfterRepeat } = await admin
      .from("engagement_items")
      .select("status, replied, resolved_at, content")
      .eq("id", rowId)
      .single();
    expect(rowAfterRepeat?.status).toBe("resolved");
    expect(rowAfterRepeat?.replied).toBe(true);
    expect(rowAfterRepeat?.resolved_at).not.toBeNull();
    expect(rowAfterRepeat?.content).toBe("Repeat upsert message");
  });

  // Acceptance Test 2
  it("2. Upsert two messages from same thread with different messageIds -> two rows, both retained, same threadExternalId, neither overwritten", async () => {
    const { POST: POST_INBOX } = await import("../../src/app/api/v1/inbox/route");

    const threadId = `th_${Date.now()}`;
    const ext1 = `ig:dm:${threadId}:msg_001`;
    const ext2 = `ig:dm:${threadId}:msg_002`;

    const res1 = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: ext1,
          fromName: "Bob",
          content: "Message 1",
          receivedAt: new Date(Date.now() - 60000).toISOString(),
        }),
      })
    );
    const data1 = await res1.json();

    const res2 = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: ext2,
          fromName: "Bob",
          content: "Message 2",
          receivedAt: new Date().toISOString(),
        }),
      })
    );
    const data2 = await res2.json();

    expect(data1.id).not.toBe(data2.id);

    const { data: rows } = await admin
      .from("engagement_items")
      .select("id, external_id, thread_external_id, content")
      .in("id", [data1.id, data2.id])
      .order("external_id", { ascending: true });

    expect(rows).toHaveLength(2);
    expect(rows?.[0].thread_external_id).toBe(`ig:dm:${threadId}`);
    expect(rows?.[1].thread_external_id).toBe(`ig:dm:${threadId}`);
    expect(rows?.[0].content).toBe("Message 1");
    expect(rows?.[1].content).toBe("Message 2");
  });

  // Acceptance Test 3
  it("3. No row can exist with replied=true and status='open' (constraint test)", async () => {
    const { error } = await admin.from("engagement_items").insert({
      tenant_slug: TENANT,
      platform: "instagram",
      type: "dm",
      external_id: `ig:dm:invalid_test_${Date.now()}`,
      from_name: "Constraint Test",
      content: "Should fail check constraint",
      status: "open",
      replied: true,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/chk_engagement_items_no_open_replied/);
  });

  // Acceptance Test 4
  it("4. Mark handoff on a thread with 2 open rows -> both become handed_off; neither appears in ?unanswered=true nor in needs_reply group", async () => {
    const { POST: POST_INBOX, GET: GET_INBOX } = await import("../../src/app/api/v1/inbox/route");
    const { GET: GET_AQ } = await import("../../src/app/api/v1/action-queue/route");
    const { POST: POST_HANDOFF } = await import("../../src/app/api/v1/conversations/handoff/route");

    const threadId = `th_ho4_${Date.now()}`;
    const ext1 = `ig:dm:${threadId}:m1`;
    const ext2 = `ig:dm:${threadId}:m2`;

    const r1 = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: ext1,
          fromName: "Charlie",
          content: "Open msg 1",
          receivedAt: new Date().toISOString(),
          status: "open",
        }),
      })
    );
    const r2 = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: ext2,
          fromName: "Charlie",
          content: "Open msg 2",
          receivedAt: new Date().toISOString(),
          status: "open",
        }),
      })
    );
    const d1 = await r1.json();
    const d2 = await r2.json();

    const handoffRes = await POST_HANDOFF(
      authedRequest("https://test.local/api/v1/conversations/handoff", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          threadExternalId: `ig:dm:${threadId}`,
          channel: "whatsapp",
          contact: "+2348012345678",
          note: "Priye handling on WhatsApp",
          movedBy: testPersonId,
        }),
      })
    );
    expect(handoffRes.status).toBe(200);

    const { data: dbRows } = await admin
      .from("engagement_items")
      .select("status")
      .in("id", [d1.id, d2.id]);
    expect(dbRows).toHaveLength(2);
    expect(dbRows?.[0].status).toBe("handed_off");
    expect(dbRows?.[1].status).toBe("handed_off");

    // Check ?unanswered=true
    const inboxRes = await GET_INBOX(
      authedRequest("https://test.local/api/v1/inbox?unanswered=true")
    );
    expect(inboxRes.status).toBe(200);
    const inboxData = await inboxRes.json();
    const returnedIds = inboxData.data.map((i: { id: string }) => i.id);
    expect(returnedIds).not.toContain(d1.id);
    expect(returnedIds).not.toContain(d2.id);

    // Check action-queue needs_reply
    const aqRes = await GET_AQ(authedRequest("https://test.local/api/v1/action-queue"));
    expect(aqRes.status).toBe(200);
    const aqData = await aqRes.json();
    const needsReplyRows = aqData.groups.find((g: { key: string }) => g.key === "needs_reply")?.rows ?? [];
    const needsReplyIds = needsReplyRows.map((r: { id: string }) => r.id);
    expect(needsReplyIds).not.toContain(d1.id);
    expect(needsReplyIds).not.toContain(d2.id);
  });

  // Acceptance Test 5
  it("5. New inbound on a handed-off thread, handoff 3 days old, normal priority -> row created as handed_off, not raised", async () => {
    const { POST: POST_INBOX } = await import("../../src/app/api/v1/inbox/route");
    const { GET: GET_AQ } = await import("../../src/app/api/v1/action-queue/route");
    const { POST: POST_HANDOFF } = await import("../../src/app/api/v1/conversations/handoff/route");

    const threadId = `th_ho5_${Date.now()}`;
    await POST_HANDOFF(
      authedRequest("https://test.local/api/v1/conversations/handoff", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          threadExternalId: `ig:dm:${threadId}`,
          channel: "whatsapp",
          movedBy: testPersonId,
        }),
      })
    );

    // Backdate to 3 days ago
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    await admin
      .from("conversation_handoffs")
      .update({ moved_at: threeDaysAgo })
      .eq("tenant_slug", TENANT)
      .eq("thread_external_id", `ig:dm:${threadId}`);

    const inRes = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: `ig:dm:${threadId}:new_msg`,
          fromName: "Dave",
          content: "Normal question 3 days later",
          receivedAt: new Date().toISOString(),
          priority: "normal",
          sentiment: "neutral",
        }),
      })
    );
    expect(inRes.status).toBe(200);
    const inData = await inRes.json();

    const { data: row } = await admin
      .from("engagement_items")
      .select("status")
      .eq("id", inData.id)
      .single();
    expect(row?.status).toBe("handed_off");

    const aqRes = await GET_AQ(authedRequest("https://test.local/api/v1/action-queue"));
    const aqData = await aqRes.json();
    const allActiveIds = aqData.groups.flatMap((g: { rows: { id: string }[] }) => g.rows.map((r) => r.id));
    expect(allActiveIds).not.toContain(inData.id);
  });

  // Acceptance Test 6
  it("6. Same but handoff 20 days old -> row created as open with the 'new message on a thread handed to...' why text", async () => {
    const { POST: POST_INBOX } = await import("../../src/app/api/v1/inbox/route");
    const { GET: GET_AQ } = await import("../../src/app/api/v1/action-queue/route");
    const { POST: POST_HANDOFF } = await import("../../src/app/api/v1/conversations/handoff/route");

    const threadId = `th_ho6_${Date.now()}`;
    await POST_HANDOFF(
      authedRequest("https://test.local/api/v1/conversations/handoff", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          threadExternalId: `ig:dm:${threadId}`,
          channel: "whatsapp",
          movedBy: testPersonId,
        }),
      })
    );

    // Backdate to 20 days ago
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    await admin
      .from("conversation_handoffs")
      .update({ moved_at: twentyDaysAgo })
      .eq("tenant_slug", TENANT)
      .eq("thread_external_id", `ig:dm:${threadId}`);

    const inRes = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: `ig:dm:${threadId}:stale_msg`,
          fromName: "Eve",
          content: "Question on a stale handoff",
          receivedAt: new Date().toISOString(),
          priority: "normal",
          sentiment: "neutral",
        }),
      })
    );
    expect(inRes.status).toBe(200);
    const inData = await inRes.json();

    const { data: row } = await admin
      .from("engagement_items")
      .select("status, why")
      .eq("id", inData.id)
      .single();
    expect(row?.status).toBe("open");
    expect(row?.why).toMatch(/new message on a thread handed to whatsapp/i);

    // Row appears in action-queue with handoffStale: true
    const aqRes = await GET_AQ(authedRequest("https://test.local/api/v1/action-queue"));
    const aqData = await aqRes.json();
    const queueRow = aqData.groups
      .flatMap((g: { rows: { id: string; handoffStale?: boolean }[] }) => g.rows)
      .find((r: { id: string }) => r.id === inData.id);
    expect(queueRow).toBeDefined();
    expect(queueRow?.handoffStale).toBe(true);
  });

  // Acceptance Test 7
  it("7. Same but priority urgent -> row created as open regardless of handoff age", async () => {
    const { POST: POST_INBOX } = await import("../../src/app/api/v1/inbox/route");
    const { POST: POST_HANDOFF } = await import("../../src/app/api/v1/conversations/handoff/route");

    const threadId = `th_ho7_${Date.now()}`;
    await POST_HANDOFF(
      authedRequest("https://test.local/api/v1/conversations/handoff", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          threadExternalId: `ig:dm:${threadId}`,
          channel: "whatsapp",
          movedBy: testPersonId,
        }),
      })
    );

    // Urgent message arrives immediately
    const inRes = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: `ig:dm:${threadId}:urg_msg`,
          fromName: "Frank",
          content: "Urgent issue!",
          receivedAt: new Date().toISOString(),
          priority: "urgent",
          sentiment: "neutral",
        }),
      })
    );
    expect(inRes.status).toBe(200);
    const inData = await inRes.json();

    const { data: row } = await admin
      .from("engagement_items")
      .select("status, why")
      .eq("id", inData.id)
      .single();
    expect(row?.status).toBe("open");
    expect(row?.why).toMatch(/new message on a thread handed to whatsapp/i);
  });

  // Acceptance Test 8
  it("8. Clear handoff -> rows stay handed_off; GET handoff returns null", async () => {
    const { POST: POST_INBOX } = await import("../../src/app/api/v1/inbox/route");
    const {
      POST: POST_HANDOFF,
      DELETE: DELETE_HANDOFF,
      GET: GET_HANDOFF,
    } = await import("../../src/app/api/v1/conversations/handoff/route");

    const threadId = `th_ho8_${Date.now()}`;
    const itemRes = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: `ig:dm:${threadId}:m1`,
          fromName: "Grace",
          content: "Item to hand off and clear",
          receivedAt: new Date().toISOString(),
          status: "open",
        }),
      })
    );
    const itemData = await itemRes.json();

    // Mark handoff
    await POST_HANDOFF(
      authedRequest("https://test.local/api/v1/conversations/handoff", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          threadExternalId: `ig:dm:${threadId}`,
          channel: "phone",
          movedBy: testPersonId,
        }),
      })
    );

    // Clear handoff via DELETE
    const delRes = await DELETE_HANDOFF(
      authedRequest("https://test.local/api/v1/conversations/handoff", {
        method: "DELETE",
        body: JSON.stringify({
          platform: "instagram",
          threadExternalId: `ig:dm:${threadId}`,
        }),
      })
    );
    expect(delRes.status).toBe(200);

    // Verify row stays handed_off (does not auto-reopen)
    const { data: row } = await admin
      .from("engagement_items")
      .select("status")
      .eq("id", itemData.id)
      .single();
    expect(row?.status).toBe("handed_off");

    // Verify GET handoff returns null
    const getHandoffRes = await GET_HANDOFF(
      authedRequest(
        `https://test.local/api/v1/conversations/handoff?platform=instagram&threadExternalId=ig:dm:${threadId}`
      )
    );
    expect(getHandoffRes.status).toBe(200);
    const getHandoffData = await getHandoffRes.json();
    expect(getHandoffData.handoff).toBeNull();
  });

  // Acceptance Test 9
  it("9. GET /api/v1/inbox returns meta and threadExternalId", async () => {
    const { POST: POST_INBOX, GET: GET_INBOX } = await import("../../src/app/api/v1/inbox/route");

    const threadId = `th_meta9_${Date.now()}`;
    const extId = `ig:dm:${threadId}:m1`;
    const metaObj = { sourceCampaign: "summer_sale", tag: "vip" };

    const inRes = await POST_INBOX(
      authedRequest("https://test.local/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          platform: "instagram",
          type: "dm",
          externalId: extId,
          fromName: "Hannah",
          content: "Testing meta return",
          receivedAt: new Date().toISOString(),
          meta: metaObj,
        }),
      })
    );
    expect(inRes.status).toBe(200);
    const inData = await inRes.json();

    const getInboxRes = await GET_INBOX(authedRequest("https://test.local/api/v1/inbox"));
    expect(getInboxRes.status).toBe(200);
    const inboxData = await getInboxRes.json();
    const item = inboxData.data.find((i: { id: string }) => i.id === inData.id);

    expect(item).toBeDefined();
    expect(item.threadExternalId).toBe(`ig:dm:${threadId}`);
    expect(item.meta).toEqual(metaObj);
  });

  // Acceptance Test 10
  it("10. Repair migration: seeded bad rows (resolved_at > received_at, status open) are corrected and logged", async () => {
    // Seed bad row 1: status open, resolved_at > received_at
    const { data: bad1 } = await admin
      .from("engagement_items")
      .insert({
        tenant_slug: TENANT,
        platform: "instagram",
        type: "dm",
        external_id: `ig:dm:repair_bad_1_${Date.now()}`,
        from_name: "Repair User 1",
        content: "Bad row 1: resolved_at > received_at",
        received_at: "2026-10-01T10:00:00Z",
        resolved_at: "2026-10-15T10:00:00Z",
        status: "open",
        replied: false,
      })
      .select("id")
      .single();

    // Seed bad row 2: status open, received_at > resolved_at
    const { data: bad2 } = await admin
      .from("engagement_items")
      .insert({
        tenant_slug: TENANT,
        platform: "instagram",
        type: "dm",
        external_id: `ig:dm:repair_bad_2_${Date.now()}`,
        from_name: "Repair User 2",
        content: "Bad row 2: received_at > resolved_at",
        received_at: "2026-10-25T10:00:00Z",
        resolved_at: "2026-10-10T10:00:00Z",
        status: "open",
        replied: false,
      })
      .select("id")
      .single();

    expect(bad1?.id).toBeDefined();
    expect(bad2?.id).toBeDefined();

    // Run repair routine
    const result = await repairInconsistentEngagementRows(admin, TENANT);
    const repairedIds = result.repaired.map((r) => r.id);

    expect(repairedIds).toContain(bad1?.id);
    expect(repairedIds).toContain(bad2?.id);

    // Verify row 1 in DB has resolved_at nulled
    const { data: fixed1 } = await admin
      .from("engagement_items")
      .select("resolved_at, replied, status")
      .eq("id", bad1!.id)
      .single();
    expect(fixed1?.status).toBe("open");
    expect(fixed1?.resolved_at).toBeNull();
    expect(fixed1?.replied).toBe(false);

    // Verify row 2 in DB has replied=false and resolved_at nulled
    const { data: fixed2 } = await admin
      .from("engagement_items")
      .select("resolved_at, replied, status")
      .eq("id", bad2!.id)
      .single();
    expect(fixed2?.status).toBe("open");
    expect(fixed2?.resolved_at).toBeNull();
    expect(fixed2?.replied).toBe(false);
  });
});
