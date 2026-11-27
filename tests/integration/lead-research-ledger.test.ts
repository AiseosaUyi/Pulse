import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

function nodeToWebHandler(handler: (req: Request) => Promise<Response>) {
  return async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const url = `http://localhost${nodeReq.url}`;
    const chunks: Buffer[] = [];
    for await (const chunk of nodeReq) chunks.push(chunk as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value) headers.set(key, value);
    }

    const webReq = new Request(url, {
      method: nodeReq.method,
      headers,
      body: nodeReq.method === "GET" || nodeReq.method === "HEAD" ? undefined : body,
      // @ts-expect-error -- required by undici
      duplex: "half",
    });

    const webRes = await handler(webReq);
    nodeRes.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
    }
    nodeRes.end();
  };
}

let server: Server;
let endpoint: string;

const GRUVE_TENANT = "gruve";
const SIPPY_TENANT = "sippy";

let gruveToken: string;
let sippyToken: string;

const TEST_RUN_ID = `test-run-${Date.now()}`;
const TEST_DOMAIN = `test-lead-${Date.now()}.ng`;
const TEST_HANDLE = `lead_${Date.now()}`;
const CREATED_PROSPECT_IDS: string[] = [];

beforeAll(async () => {
  // Ensure both tenants exist
  await admin.from("tenants").upsert({ slug: GRUVE_TENANT, name: "Gruve" }, { onConflict: "slug" });
  await admin.from("tenants").upsert({ slug: SIPPY_TENANT, name: "Sippy" }, { onConflict: "slug" });

  const scope = "sales:read,sales:write,publish:read,publish:write,engage:read,engage:write";

  // Create temporary API tokens for Gruve and Sippy
  const rawGruve = generateToken();
  const { error: gErr } = await admin.from("tenant_api_tokens").insert({
    tenant_slug: GRUVE_TENANT,
    name: `test-lead-gruve-${Date.now()}`,
    token_hash: hashToken(rawGruve),
    token_prefix: rawGruve.slice(0, 14),
    token_last4: rawGruve.slice(-4),
    scope,
  });
  if (gErr) throw gErr;
  gruveToken = rawGruve;

  const rawSippy = generateToken();
  const { error: sErr } = await admin.from("tenant_api_tokens").insert({
    tenant_slug: SIPPY_TENANT,
    name: `test-lead-sippy-${Date.now()}`,
    token_hash: hashToken(rawSippy),
    token_prefix: rawSippy.slice(0, 14),
    token_last4: rawSippy.slice(-4),
    scope,
  });
  if (sErr) throw sErr;
  sippyToken = rawSippy;

  // Spin up test server
  const { GET: handler } = await import("../../src/app/api/[transport]/route");
  server = createServer(nodeToWebHandler(handler as (req: Request) => Promise<Response>));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  endpoint = `http://localhost:${port}`;
});

afterAll(async () => {
  server?.close();

  // Cleanup test tokens
  await admin.from("tenant_api_tokens").delete().like("name", "test-lead-%");

  // Cleanup ledger entries created by test
  await admin.from("outreach_ledger").delete().in("key", [TEST_DOMAIN, TEST_HANDLE, `cross-${TEST_DOMAIN}`]);

  // Cleanup prospects
  if (CREATED_PROSPECT_IDS.length > 0) {
    await admin.from("prospects").delete().in("id", CREATED_PROSPECT_IDS);
  }
  await admin.from("prospects").delete().eq("run_id", TEST_RUN_ID);
  await admin.from("prospect_replies").delete().eq("run_id", TEST_RUN_ID);
  await admin.from("agent_runs").delete().eq("run_id", TEST_RUN_ID);
});

async function connectClient(bearerToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
  const client = new Client({ name: "pulse-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function parseJsonToolResult(res: any): any {
  if (res.isError) {
    throw new Error(`Tool returned error: ${JSON.stringify(res)}`);
  }
  const text = res.content?.[0]?.text;
  if (!text) return res;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("Lead Research, Outreach Ledger, and Safety Invariants", () => {
  it("enforces workspace isolation: Gruve ledger entry is not visible to Sippy", async () => {
    const gruveClient = await connectClient(gruveToken);
    const sippyClient = await connectClient(sippyToken);

    const isolationDomain = `cross-${TEST_DOMAIN}`;

    // Add entry under Gruve
    const addRes = await gruveClient.callTool({
      name: "ledger_add",
      arguments: {
        kind: "DROPPED",
        domain: isolationDomain,
        company_name: "Gruve Secret Organizer",
        reason: "Gruve test dropped",
        run_id: TEST_RUN_ID,
      },
    });
    const addData = parseJsonToolResult(addRes);
    expect(addData.success).toBe(true);
    expect(addData.sent).toBe(false);

    // List on Gruve -> shows the domain
    const gListRes = await gruveClient.callTool({
      name: "ledger_list",
      arguments: { domains: [isolationDomain] },
    });
    const gListData = parseJsonToolResult(gListRes);
    expect(gListData.entries.length).toBe(1);
    expect(gListData.sent).toBe(false);
    expect(gListData.entries[0].key).toBe(isolationDomain);

    // List on Sippy -> empty, Gruve entry is completely invisible
    const sListRes = await sippyClient.callTool({
      name: "ledger_list",
      arguments: { domains: [isolationDomain] },
    });
    const sListData = parseJsonToolResult(sListRes);
    expect(sListData.entries.length).toBe(0);
    expect(sListData.sent).toBe(false);
    expect(sListData.entries).toEqual([]);

    await gruveClient.close();
    await sippyClient.close();
  });

  it("enforces no-downgrade rule: CONTACTED entry cannot be downgraded to DROPPED", async () => {
    const client = await connectClient(gruveToken);

    // 1. Add as CONTACTED
    const addContacted = await client.callTool({
      name: "ledger_add",
      arguments: {
        kind: "CONTACTED",
        handle: TEST_HANDLE,
        company_name: "Test Contacted Brand",
        reason: "Initial outreach sent",
        run_id: TEST_RUN_ID,
      },
    });
    const cData = parseJsonToolResult(addContacted);
    expect(cData.success).toBe(true);
    expect(cData.sent).toBe(false);

    // 2. Attempt to add same key as DROPPED
    const addDropped = await client.callTool({
      name: "ledger_add",
      arguments: {
        kind: "DROPPED",
        handle: TEST_HANDLE,
        company_name: "Test Contacted Brand",
        reason: "Attempted downgrade",
        run_id: TEST_RUN_ID,
      },
    });
    const dData = parseJsonToolResult(addDropped);
    expect(dData.success).toBe(true);
    expect(dData.sent).toBe(false);

    // 3. Verify it is STILL CONTACTED
    const listRes = await client.callTool({
      name: "ledger_list",
      arguments: { handles: [TEST_HANDLE] },
    });
    const listData = parseJsonToolResult(listRes);
    expect(listData.entries.length).toBe(1);
    expect(listData.entries[0].kind).toBe("CONTACTED");

    await client.close();
  });

  it("skips upsert when domain is in ledger, and ignore_ledger: true overrides skip", async () => {
    const client = await connectClient(gruveToken);

    // 1. Add domain to ledger as DROPPED
    await client.callTool({
      name: "ledger_add",
      arguments: {
        kind: "DROPPED",
        domain: TEST_DOMAIN,
        company_name: "Excluded Lead Corp",
        reason: "Out of scope segment",
        run_id: TEST_RUN_ID,
      },
    });

    // 2. Attempt pulse_upsert_prospect with that domain -> should be skipped
    const skipRes = await client.callTool({
      name: "pulse_upsert_prospect",
      arguments: {
        platform: "instagram",
        handle: `ex_${Date.now()}`,
        website: `https://${TEST_DOMAIN}`,
        company_name: "Excluded Lead Corp",
        run_id: TEST_RUN_ID,
      },
    });
    const skipData = parseJsonToolResult(skipRes);
    expect(skipData.skipped).toBe(true);
    expect(skipData.sent).toBe(false);
    expect(skipData.ledger).toBeDefined();
    expect(skipData.ledger.kind).toBe("DROPPED");
    expect(skipData.ledger.key).toBe(TEST_DOMAIN);

    // 3. Upsert with ignore_ledger: true -> should proceed
    const overrideRes = await client.callTool({
      name: "pulse_upsert_prospect",
      arguments: {
        platform: "instagram",
        handle: `ex_${Date.now()}`,
        website: `https://${TEST_DOMAIN}`,
        company_name: "Excluded Lead Corp",
        run_id: TEST_RUN_ID,
        ignore_ledger: true,
      },
    });
    const overrideData = parseJsonToolResult(overrideRes);
    expect(overrideData.skipped).toBe(false);
    expect(overrideData.sent).toBe(false);
    expect(overrideData.prospect).toBeDefined();
    expect(overrideData.prospect.id).toBeDefined();
    CREATED_PROSPECT_IDS.push(overrideData.prospect.id);

    await client.close();
  });

  it("verifies run_report matches exact required format and sent: false", async () => {
    const client = await connectClient(gruveToken);

    // Start a run
    const startRes = await client.callTool({
      name: "pulse_start_run",
      arguments: {
        agent: "lead_researcher",
        runId: TEST_RUN_ID,
        searchBudget: 50,
        sliceLabel: "Lagos Venue Curators",
      },
    });
    const startData = parseJsonToolResult(startRes);
    expect(startData.sent).toBe(false);
    expect(startData.runId).toBe(TEST_RUN_ID);

    // Call run_report
    const reportRes = await client.callTool({
      name: "run_report",
      arguments: { run_id: TEST_RUN_ID },
    });
    const reportData = parseJsonToolResult(reportRes);
    expect(reportData.sent).toBe(false);
    expect(reportData.report_line).toBeDefined();

    // Must match: "Run <run_id>: researched X, skipped Y (ledger), upserted Z. Emails: kept A, dropped B (reasons), unverified C. Nothing was sent."
    const exactRegex = /^Run [^:]+: researched \d+, skipped \d+ \(ledger\), upserted \d+\. Emails: kept \d+, dropped \d+.*, unverified \d+\. Nothing was sent\.$/;
    expect(reportData.report_line).toMatch(exactRegex);
    expect(reportData.report_line).toContain("Nothing was sent.");

    // Finish run
    const finishRes = await client.callTool({
      name: "pulse_finish_run",
      arguments: {
        runId: startData.runId ?? startData.id,
        itemsProcessed: 1,
      },
    });
    const finishData = parseJsonToolResult(finishRes);
    expect(finishData.sent).toBe(false);

    await client.close();
  });

  it("confirms sent: false across all new MCP tools", async () => {
    const client = await connectClient(gruveToken);

    // 1. pulse_compose_drafts
    const draftRes = await client.callTool({
      name: "pulse_compose_drafts",
      arguments: {
        batch_size: 10,
        run_id: TEST_RUN_ID,
      },
    });
    const draftData = parseJsonToolResult(draftRes);
    expect(draftData.sent).toBe(false);

    // 2. pulse_record_reply
    const replyRes = await client.callTool({
      name: "pulse_record_reply",
      arguments: {
        handle: "test_replier",
        channel: "email",
        quote: "We only work with Paystack right now",
        status: "declined",
        next_step: "Follow up in Q3",
        missing_capability: "Paystack split ticketing",
        run_id: TEST_RUN_ID,
      },
    });
    const replyData = parseJsonToolResult(replyRes);
    expect(replyData.sent).toBe(false);
    expect(replyData.success).toBe(true);

    // 3. pulse_replies_insights
    const insightRes = await client.callTool({
      name: "pulse_replies_insights",
      arguments: { days: 7 },
    });
    const insightData = parseJsonToolResult(insightRes);
    expect(insightData.sent).toBe(false);
    expect(Array.isArray(insightData.insights)).toBe(true);

    await client.close();
  });
});
