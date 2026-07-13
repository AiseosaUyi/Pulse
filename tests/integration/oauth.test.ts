import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { admin } from "../helpers/clients";
import { mintAuthorizationCode } from "../../src/lib/oauth/codes";
import { registerClient } from "../../src/lib/oauth/clients";

// Real-DB integration test for the MCP OAuth 2.1 authorization server.
// Uses a throwaway real auth.users row (created/destroyed here, not the
// broken-locally SEED_* helper — oauth_authorization_codes.user_id has a
// real FK to auth.users, so a fabricated UUID won't satisfy it) and a
// throwaway tenant. Authorization codes are seeded directly via
// mintAuthorizationCode (the same function POST /api/oauth/token's
// happy-path test then exercises for real) rather than driving the actual
// browser consent page — same "seed the state a UI action would have
// produced, then test the API surface for real" pattern as
// api-v1-approvals.test.ts.

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

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

const TENANT = `oauth-test-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL = `oauth-test-${Math.random().toString(36).slice(2, 8)}@example.com`;
const REDIRECT_URI = "https://cowork.example.com/callback";

let userId: string;
let clientId: string;

beforeAll(async () => {
  const { error: tErr } = await admin.from("tenants").insert({ slug: TENANT, name: "OAuth Test" });
  if (tErr) throw tErr;

  const { data: userData, error: uErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: randomBytes(16).toString("hex"),
    email_confirm: true,
  });
  if (uErr || !userData.user) throw uErr ?? new Error("createUser failed");
  userId = userData.user.id;

  const result = await registerClient(admin, {
    clientName: "Test Client",
    redirectUris: [REDIRECT_URI],
  });
  if (!result.ok) throw new Error(result.error);
  clientId = result.client.id;
});

afterAll(async () => {
  await admin.from("tenants").delete().eq("slug", TENANT);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function seedAuthorizationCode(overrides: { expired?: boolean } = {}) {
  const { verifier, challenge } = pkcePair();
  const code = await mintAuthorizationCode(admin, {
    clientId,
    userId,
    tenantSlug: TENANT,
    scopes: ["sales:read", "content:write"],
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
  });
  if (overrides.expired) {
    await admin
      .from("oauth_authorization_codes")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("code_hash", createHash("sha256").update(code).digest("hex"));
  }
  return { code, verifier };
}

describe("/api/oauth Dynamic Client Registration", () => {
  it("POST /api/oauth/register creates a public client", async () => {
    const { POST } = await import("../../src/app/api/oauth/register/route");
    const res = await POST(
      new Request("https://test.local/api/oauth/register", {
        method: "POST",
        body: JSON.stringify({ client_name: "Cowork", redirect_uris: [REDIRECT_URI] }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toMatch(/^mcp_client_/);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.redirect_uris).toEqual([REDIRECT_URI]);
  });

  it("rejects a registration with no redirect_uris", async () => {
    const { POST } = await import("../../src/app/api/oauth/register/route");
    const res = await POST(
      new Request("https://test.local/api/oauth/register", {
        method: "POST",
        body: JSON.stringify({ client_name: "Bad Client" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });
});

describe("/api/oauth/token", () => {
  it("exchanges a valid authorization code + PKCE verifier for tokens", async () => {
    const { code, verifier } = await seedAuthorizationCode();
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const res = await POST(
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token_type).toBe("Bearer");
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    expect(body.scope).toBe("sales:read content:write");
  });

  it("rejects the wrong PKCE verifier", async () => {
    const { code } = await seedAuthorizationCode();
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const res = await POST(
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: "not-the-real-verifier",
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  it("rejects an expired authorization code", async () => {
    const { code, verifier } = await seedAuthorizationCode({ expired: true });
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const res = await POST(
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a replayed (already-used) authorization code", async () => {
    const { code, verifier } = await seedAuthorizationCode();
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const makeReq = () =>
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }),
      });
    const first = await POST(makeReq());
    expect(first.status).toBe(200);
    const second = await POST(makeReq());
    expect(second.status).toBe(400);
  });

  it("rotates a refresh token: old one stops working, new one works", async () => {
    const { code, verifier } = await seedAuthorizationCode();
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const exchange = await POST(
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }),
      })
    );
    const { refresh_token: originalRefresh } = await exchange.json();

    const refreshReq = () =>
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: originalRefresh }),
      });

    const rotated = await POST(refreshReq());
    expect(rotated.status).toBe(200);
    const rotatedBody = await rotated.json();
    expect(typeof rotatedBody.access_token).toBe("string");
    expect(rotatedBody.refresh_token).not.toBe(originalRefresh);

    // Old refresh token is now revoked — a second use must fail.
    const replay = await POST(refreshReq());
    expect(replay.status).toBe(400);
  });

  it("rejects an unsupported grant_type", async () => {
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const res = await POST(
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "password", username: "x", password: "y" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsupported_grant_type");
  });
});

describe("/.well-known metadata", () => {
  it("GET /api/oauth/authorization-server-metadata advertises PKCE + the DCR endpoint", async () => {
    const { GET } = await import("../../src/app/api/oauth/authorization-server-metadata/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.grant_types_supported).toContain("authorization_code");
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(typeof body.registration_endpoint).toBe("string");
  });
});

describe("MCP route accepts a real OAuth access token end-to-end", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    const { GET: handler } = await import("../../src/app/api/[transport]/route");
    server = createServer(nodeToWebHandler(handler as (req: Request) => Promise<Response>));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    endpoint = `http://localhost:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  async function connectClient(bearerToken?: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/api/mcp`), {
      requestInit: bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : undefined,
    });
    const client = new Client({ name: "pulse-oauth-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
  }

  it("pulse_whoami resolves the tenant from a freshly-minted OAuth access token", async () => {
    const { code, verifier } = await seedAuthorizationCode();
    const { POST } = await import("../../src/app/api/oauth/token/route");
    const exchange = await POST(
      new Request("https://test.local/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }),
      })
    );
    const { access_token: accessToken } = await exchange.json();

    const client = await connectClient(accessToken);
    const result = await client.callTool({ name: "pulse_whoami", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.tenant.slug).toBe(TENANT);
    expect(parsed.scopes).toContain("sales:read");
    await client.close();
  });

  it("rejects an invalid OAuth-shaped bearer token", async () => {
    await expect(connectClient("not-a-real-access-token")).rejects.toThrow();
  });
});
