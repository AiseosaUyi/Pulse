import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

const migrationApplied = await (async () => {
  const { error } = await admin.from("tasks").select("id").limit(1);
  return !error;
})();

if (!migrationApplied) {
  console.warn(
    "\n[api-v1-tasks.test.ts] SKIPPED: migration 109 " +
      "(supabase/migrations/109_tasks_and_team_people.sql) hasn't been applied to " +
      "this Supabase project yet — the `tasks` table doesn't exist. " +
      "Paste migration 109 into the Supabase SQL Editor and run it, then " +
      "re-run this test file.\n"
  );
}

const suite = migrationApplied ? describe : describe.skip;

const TENANT_A = `tasks-test-a-${Math.random().toString(36).slice(2, 8)}`;
const TENANT_B = `tasks-test-b-${Math.random().toString(36).slice(2, 8)}`;

let tokenA: string;
let tokenB: string;
let personAId: string;
let createdTaskId: string;
let occurrenceId: string;

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

function authedRequest(url: string, token: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
}

suite("/api/v1/tasks group & tenant isolation", () => {
  beforeAll(async () => {
    // 1. Create 2 test tenants
    await admin.from("tenants").insert([
      { slug: TENANT_A, name: "Tasks Tenant A", timezone: "Africa/Lagos" },
      { slug: TENANT_B, name: "Tasks Tenant B", timezone: "Africa/Lagos" },
    ]);

    // 2. Mint tokens
    tokenA = await mintToken(TENANT_A, "tasks:read,tasks:write");
    tokenB = await mintToken(TENANT_B, "tasks:read,tasks:write");

    // 3. Create team people
    const { data: pA } = await admin
      .from("team_people")
      .insert({ tenant_slug: TENANT_A, name: "Person A", active: true })
      .select()
      .single();
    personAId = pA.id;

    const { data: pB } = await admin
      .from("team_people")
      .insert({ tenant_slug: TENANT_B, name: "Person B", active: true })
      .select()
      .single();
    expect(pB.id).toBeDefined();
  });

  afterAll(async () => {
    await admin.from("tenants").delete().in("slug", [TENANT_A, TENANT_B]);
  });

  it("POST /api/v1/tasks creates task and generates occurrences", async () => {
    const { POST } = await import("../../src/app/api/v1/tasks/route");
    const today = new Date().toISOString().slice(0, 10);

    const req = authedRequest("https://test.local/api/v1/tasks", tokenA, {
      method: "POST",
      body: JSON.stringify({
        title: "Daily Social Post",
        ownerPersonId: personAId,
        kind: "recurring",
        startDate: today,
        recurrence: "daily",
        proofRequired: "link",
        proofHint: "Discord message link",
        checklist: ["Step 1", "Step 2"],
        metricLabel: "DMs sent",
        metricTarget: 5,
        tags: ["social"],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Daily Social Post");
    expect(body.tenantSlug).toBe(TENANT_A);
    createdTaskId = body.id;
  });

  it("GET /api/v1/tasks enforces tenant scoping (Tenant B cannot see Tenant A tasks)", async () => {
    const { GET } = await import("../../src/app/api/v1/tasks/route");

    // Tenant A sees the task
    const reqA = authedRequest("https://test.local/api/v1/tasks", tokenA);
    const resA = await GET(reqA);
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    expect(bodyA.length).toBe(1);
    expect(bodyA[0].title).toBe("Daily Social Post");

    // Tenant B sees nothing
    const reqB = authedRequest("https://test.local/api/v1/tasks", tokenB);
    const resB = await GET(reqB);
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB.length).toBe(0);
  });

  it("GET /api/v1/tasks/today returns occurrences with checklist", async () => {
    const { GET } = await import("../../src/app/api/v1/tasks/today/route");
    const req = authedRequest("https://test.local/api/v1/tasks/today", tokenA);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.occurrences.length).toBeGreaterThanOrEqual(1);

    const occ = body.occurrences[0];
    expect(occ.taskId).toBe(createdTaskId);
    expect(occ.checks.length).toBe(2);
    occurrenceId = occ.id;
  });

  it("POST /api/v1/tasks/occurrences/:id/complete enforces checklist before completion", async () => {
    const { POST } = await import(
      "../../src/app/api/v1/tasks/occurrences/[id]/complete/route"
    );

    // Try to complete without ticking checklist items
    const req = authedRequest(
      `https://test.local/api/v1/tasks/occurrences/${occurrenceId}/complete`,
      tokenA,
      {
        method: "POST",
        body: JSON.stringify({
          proofUrl: "https://discord.com/channels/123",
          metricValue: 5,
        }),
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: occurrenceId }) });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toContain("checklist items must be ticked");
  });

  it("POST /api/v1/tasks/occurrences/:id/complete enforces valid link proof", async () => {
    const { POST } = await import(
      "../../src/app/api/v1/tasks/occurrences/[id]/complete/route"
    );

    // Tick all checks first directly
    await admin
      .from("task_occurrence_checks")
      .update({ checked: true })
      .eq("occurrence_id", occurrenceId);

    // Provide invalid link proof
    const req = authedRequest(
      `https://test.local/api/v1/tasks/occurrences/${occurrenceId}/complete`,
      tokenA,
      {
        method: "POST",
        body: JSON.stringify({
          proofUrl: "invalid-url",
        }),
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: occurrenceId }) });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toContain("valid link");
  });

  it("POST /api/v1/tasks/occurrences/:id/complete succeeds with valid proof and checked items", async () => {
    const { POST } = await import(
      "../../src/app/api/v1/tasks/occurrences/[id]/complete/route"
    );

    const req = authedRequest(
      `https://test.local/api/v1/tasks/occurrences/${occurrenceId}/complete`,
      tokenA,
      {
        method: "POST",
        body: JSON.stringify({
          proofUrl: "https://discord.com/channels/123",
          metricValue: 6,
        }),
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: occurrenceId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Check status in DB
    const { data: occ } = await admin
      .from("task_occurrences")
      .select("status, metric_value")
      .eq("id", occurrenceId)
      .single();

    expect(occ?.status).toBe("done");
    expect(occ?.metric_value).toBe(6);
  });

  it("GET /api/v1/tasks/report returns standup report with WhatsApp plain text", async () => {
    const { GET } = await import("../../src/app/api/v1/tasks/report/route");
    const today = new Date().toISOString().slice(0, 10);
    const req = authedRequest(
      `https://test.local/api/v1/tasks/report?from=${today}&to=${today}`,
      tokenA
    );

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.people.length).toBeGreaterThanOrEqual(1);
    expect(body.whatsAppText).toContain("*Pulse Standup Report");
    expect(body.whatsAppText).toContain("*PERSON A*");
    expect(body.whatsAppText).toContain("Completed tasks: 1");
  });
});
