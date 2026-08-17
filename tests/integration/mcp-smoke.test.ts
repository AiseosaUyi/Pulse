import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";

// Real end-to-end smoke test for the remote MCP server: spins up the
// actual exported route handler behind a throwaway Node HTTP server
// (same pattern mcp-handler's own e2e.test.ts uses — the MCP SDK's
// StreamableHTTPClientTransport speaks real JSON-RPC/session framing
// that isn't worth hand-rolling), connects a real MCP Client with a
// seeded token, lists tools, and calls pulse_whoami + one read tool.

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
      // @ts-expect-error -- required by undici for requests with a body
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

const TENANT = `mcp-smoke-${Math.random().toString(36).slice(2, 8)}`;
let token: string;
let writeToken: string;
let prospectId: string;
let server: Server;
let endpoint: string;

beforeAll(async () => {
  const { error: tErr } = await admin.from("tenants").insert({ slug: TENANT, name: "MCP Smoke Test" });
  if (tErr) throw tErr;

  const raw = generateToken();
  const { error: tokErr } = await admin.from("tenant_api_tokens").insert({
    tenant_slug: TENANT,
    name: "mcp-smoke",
    token_hash: hashToken(raw),
    token_prefix: raw.slice(0, 14),
    token_last4: raw.slice(-4),
    scope: "sales:read,publish:read,engage:read",
  });
  if (tokErr) throw tokErr;
  token = raw;

  const rawWrite = generateToken();
  const { error: writeTokErr } = await admin.from("tenant_api_tokens").insert({
    tenant_slug: TENANT,
    name: "mcp-smoke-write",
    token_hash: hashToken(rawWrite),
    token_prefix: rawWrite.slice(0, 14),
    token_last4: rawWrite.slice(-4),
    scope: "sales:read,sales:write",
  });
  if (writeTokErr) throw writeTokErr;
  writeToken = rawWrite;

  const { data: prospect, error: pErr } = await admin
    .from("prospects")
    .insert({ tenant_slug: TENANT, platform: "instagram", handle: "mcp-smoke-lead" })
    .select("id")
    .single();
  if (pErr) throw pErr;
  prospectId = prospect.id;

  const { GET: handler } = await import("../../src/app/api/[transport]/route");
  server = createServer(nodeToWebHandler(handler as (req: Request) => Promise<Response>));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  endpoint = `http://localhost:${port}`;
});

afterAll(async () => {
  server?.close();
  await admin.from("tenants").delete().eq("slug", TENANT);
});

async function connectClient(bearerToken?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/api/mcp`), {
    requestInit: bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : undefined,
  });
  const client = new Client({ name: "pulse-mcp-smoke-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

describe("MCP server smoke test", () => {
  it("rejects a connection with no bearer token", async () => {
    await expect(connectClient()).rejects.toThrow();
  });

  it("lists tools including every shipped group", async () => {
    const client = await connectClient(token);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("pulse_whoami");
    expect(names).toContain("pulse_manifest");
    expect(names).toContain("pulse_list_prospects");
    expect(names).toContain("pulse_set_prospect_quality");
    expect(names).toContain("pulse_mark_duplicate");
    expect(names).toContain("pulse_publish_queue");
    expect(names).toContain("pulse_inbox");
    expect(names).toContain("pulse_intel_feed");
    expect(names).toContain("pulse_seo_recommendations");
    expect(names).toContain("pulse_analytics_overview");
    expect(names).toContain("pulse_list_blog_posts");
    expect(names).toContain("pulse_compose_caption");
    expect(names).toContain("pulse_send_briefing");
    expect(names).toContain("pulse_list_pending_approvals");
    expect(tools.length).toBeGreaterThanOrEqual(39);

    await client.close();
  });

  it("calls pulse_whoami and resolves the seeded tenant", async () => {
    const client = await connectClient(token);
    const result = await client.callTool({ name: "pulse_whoami", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.tenant.slug).toBe(TENANT);
    expect(parsed.scopes).toContain("sales:read");

    await client.close();
  });

  it("calls pulse_list_prospects (a read tool) successfully", async () => {
    const client = await connectClient(token);
    const result = await client.callTool({ name: "pulse_list_prospects", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.data)).toBe(true);

    await client.close();
  });

  it("rejects a write tool call when the token lacks the write scope", async () => {
    const client = await connectClient(token);
    const result = await client.callTool({
      name: "pulse_upsert_prospect",
      arguments: { platform: "instagram", handle: "smoke-test" },
    });
    expect(result.isError).toBe(true);

    await client.close();
  });

  it("calls pulse_set_prospect_quality against a real prospect", async () => {
    const client = await connectClient(writeToken);
    const result = await client.callTool({
      name: "pulse_set_prospect_quality",
      arguments: { id: prospectId, quality: "warm" },
    });
    expect(result.isError).not.toBe(true);

    const { data } = await admin.from("prospects").select("quality").eq("id", prospectId).single();
    expect(data?.quality).toBe("warm");

    await client.close();
  });

  it("calls pulse_mark_duplicate to mark then unmark against a real prospect", async () => {
    const { data: other, error } = await admin
      .from("prospects")
      .insert({ tenant_slug: TENANT, platform: "instagram", handle: "mcp-smoke-original" })
      .select("id")
      .single();
    if (error) throw error;

    const client = await connectClient(writeToken);
    const markResult = await client.callTool({
      name: "pulse_mark_duplicate",
      arguments: { id: prospectId, duplicateOfId: other.id },
    });
    expect(markResult.isError).not.toBe(true);

    const { data: marked } = await admin
      .from("prospects")
      .select("duplicate_of_id, status")
      .eq("id", prospectId)
      .single();
    expect(marked?.duplicate_of_id).toBe(other.id);
    expect(marked?.status).toBe("dismissed");

    const unmarkResult = await client.callTool({
      name: "pulse_mark_duplicate",
      arguments: { id: prospectId, duplicateOfId: null },
    });
    expect(unmarkResult.isError).not.toBe(true);

    const { data: unmarked } = await admin
      .from("prospects")
      .select("duplicate_of_id")
      .eq("id", prospectId)
      .single();
    expect(unmarked?.duplicate_of_id).toBeNull();

    await client.close();
  });
});
