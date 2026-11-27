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

let gruveToken: string;
let sippyToken: string;

const CLEANUP_KEYS: string[] = [];

beforeAll(async () => {
  const { GET: handler } = await import("../../src/app/api/[transport]/route");
  server = createServer(nodeToWebHandler(handler as (req: Request) => Promise<Response>));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  endpoint = `http://localhost:${port}`;

  const scope = "sales:read,sales:write,publish:read,publish:write,engage:read,engage:write";

  const rawGruve = generateToken();
  await admin.from("tenant_api_tokens").insert({
    tenant_slug: "gruve",
    name: `smoke-gruve-${Date.now()}`,
    token_hash: hashToken(rawGruve),
    token_prefix: rawGruve.slice(0, 14),
    token_last4: rawGruve.slice(-4),
    scope,
  });
  gruveToken = rawGruve;

  const rawSippy = generateToken();
  await admin.from("tenant_api_tokens").insert({
    tenant_slug: "sippy",
    name: `smoke-sippy-${Date.now()}`,
    token_hash: hashToken(rawSippy),
    token_prefix: rawSippy.slice(0, 14),
    token_last4: rawSippy.slice(-4),
    scope,
  });
  sippyToken = rawSippy;
});

afterAll(async () => {
  server?.close();
  await admin.from("tenant_api_tokens").delete().like("name", "smoke-%");
  if (CLEANUP_KEYS.length > 0) {
    await admin.from("outreach_ledger").delete().in("key", CLEANUP_KEYS);
  }
});

async function connectClient(bearerToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
  const client = new Client({ name: "pulse-smoke-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function parseJsonResult(res: any): any {
  if (res.isError) throw new Error(JSON.stringify(res));
  return JSON.parse(res.content[0].text);
}

describe("Step 7 Production Deploy Smoke Tests", () => {
  describe("Gruve MCP Server Smoke Test", () => {
    it("ledger_add test domain as DROPPED, pulse_upsert_prospect returns skipped: true, run_report runs", async () => {
      const client = await connectClient(gruveToken);
      const testRunId = `smoke-gruve-run-${Date.now()}`;
      const testDomain = `smoke-gruve-${Date.now()}.ng`;
      CLEANUP_KEYS.push(testDomain);

      // 1. ledger_add test domain as DROPPED
      const addRes = await client.callTool({
        name: "ledger_add",
        arguments: {
          kind: "DROPPED",
          domain: testDomain,
          company_name: "Lagos Venue Test",
          reason: "Too large enterprise group",
          run_id: testRunId,
        },
      });
      const addData = parseJsonResult(addRes);
      expect(addData.success).toBe(true);
      expect(addData.sent).toBe(false);

      // 2. confirm pulse_upsert_prospect for that domain returns skipped: true
      const upsertRes = await client.callTool({
        name: "pulse_upsert_prospect",
        arguments: {
          platform: "instagram",
          handle: `gruve_lead_${Date.now()}`,
          website: `https://${testDomain}`,
          company_name: "Lagos Venue Test",
          run_id: testRunId,
        },
      });
      const upsertData = parseJsonResult(upsertRes);
      expect(upsertData.skipped).toBe(true);
      expect(upsertData.sent).toBe(false);
      expect(upsertData.ledger.kind).toBe("DROPPED");
      expect(upsertData.ledger.key).toBe(testDomain);

      // 3. confirm run_report runs
      const reportRes = await client.callTool({
        name: "run_report",
        arguments: { run_id: testRunId },
      });
      const reportData = parseJsonResult(reportRes);
      expect(reportData.sent).toBe(false);
      expect(reportData.report).toContain("Nothing was sent.");
      expect(reportData.report).toMatch(/^Run [^:]+: researched \d+, skipped \d+ \(ledger\), upserted \d+\. Emails: kept \d+, dropped \d+.*, unverified \d+\. Nothing was sent\.$/);

      await client.close();
    });
  });

  describe("Sippy MCP Server Smoke Test", () => {
    it("ledger_add test domain as DROPPED, pulse_upsert_prospect returns skipped: true, run_report runs", async () => {
      const client = await connectClient(sippyToken);
      const testRunId = `smoke-sippy-run-${Date.now()}`;
      const testDomain = `smoke-sippy-${Date.now()}.com`;
      CLEANUP_KEYS.push(testDomain);

      // 1. ledger_add test domain as DROPPED
      const addRes = await client.callTool({
        name: "ledger_add",
        arguments: {
          kind: "DROPPED",
          domain: testDomain,
          company_name: "Abuja Cocktail Lounge",
          reason: "Retail buyer closed for renovation",
          run_id: testRunId,
        },
      });
      const addData = parseJsonResult(addRes);
      expect(addData.success).toBe(true);
      expect(addData.sent).toBe(false);

      // 2. confirm pulse_upsert_prospect for that domain returns skipped: true
      const upsertRes = await client.callTool({
        name: "pulse_upsert_prospect",
        arguments: {
          platform: "instagram",
          handle: `sippy_lead_${Date.now()}`,
          website: `https://${testDomain}`,
          company_name: "Abuja Cocktail Lounge",
          run_id: testRunId,
        },
      });
      const upsertData = parseJsonResult(upsertRes);
      expect(upsertData.skipped).toBe(true);
      expect(upsertData.sent).toBe(false);
      expect(upsertData.ledger.kind).toBe("DROPPED");
      expect(upsertData.ledger.key).toBe(testDomain);

      // 3. confirm run_report runs
      const reportRes = await client.callTool({
        name: "run_report",
        arguments: { run_id: testRunId },
      });
      const reportData = parseJsonResult(reportRes);
      expect(reportData.sent).toBe(false);
      expect(reportData.report).toContain("Nothing was sent.");
      expect(reportData.report).toMatch(/^Run [^:]+: researched \d+, skipped \d+ \(ledger\), upserted \d+\. Emails: kept \d+, dropped \d+.*, unverified \d+\. Nothing was sent\.$/);

      await client.close();
    });
  });
});
