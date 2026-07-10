// Remote MCP server exposing every /api/v1 capability as an MCP tool,
// so Cowork (whose sandbox has no outbound internet — plain HTTP from
// a skill's shell doesn't reach Pulse) can drive Pulse over the MCP
// transport instead. Streamable HTTP only for now — SSE needs Redis
// for session state, deferred until that's provisioned (see
// docs/API-V1.md).
//
// Auth reuses the exact same token system as /api/v1: withMcpAuth()
// calls resolveApiToken() once per request (identical to
// requireApiContext()'s REST-side gate) and stashes the result on
// every tool call's `extra.authInfo`. Tools never accept a tenant
// argument from the model — src/lib/api/mcp-context.ts's
// requireToolScope() is the only way a tool resolves its tenant.

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveApiToken } from "@/lib/api-tokens";
import { checkPreAuthRateLimit } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/context";
import type { McpTokenExtra } from "@/lib/api/mcp-context";
import { registerMetaTools } from "@/lib/mcp/tools/meta";
import { registerSalesTools } from "@/lib/mcp/tools/sales";
import { registerPublishingTools } from "@/lib/mcp/tools/publishing";
import { registerEngagementTools } from "@/lib/mcp/tools/engagement";

// [transport] is a literal dynamic segment mcp-handler resolves itself
// (it becomes "mcp" for streamable HTTP, "sse"/"message" for SSE) — it
// is NOT a folder named "mcp". basePath is the parent path this file
// sits under, so the real served (and public) URL is {basePath}/mcp,
// i.e. /api/mcp — confirmed against mcp-handler's own calculateEndpoints
// tests, not just the docs prose.
const handler = createMcpHandler(
  (server) => {
    registerMetaTools(server);
    registerSalesTools(server);
    registerPublishingTools(server);
    registerEngagementTools(server);
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
  }
);

const verifyToken = async (
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  // Gate ahead of the token lookup — same reasoning as REST's
  // requireApiContext(): any well-formed bearer costs a real Supabase
  // admin-client round-trip whether or not it turns out to be valid.
  // withMcpAuth only distinguishes "auth failed" (this return type) from
  // success, so a rate-limited request surfaces as the same 401 shape a
  // bad token would — a minor simplification, not a 429.
  if (!checkPreAuthRateLimit(getClientIp(req)).ok) return undefined;
  const resolved = await resolveApiToken(bearerToken);
  if (!resolved) return undefined;

  const extra: McpTokenExtra = {
    tenantSlug: resolved.tenantSlug,
    tokenId: resolved.tokenId,
    createdBy: resolved.createdBy,
  };
  return {
    token: bearerToken,
    scopes: resolved.scopes,
    clientId: resolved.tenantSlug,
    extra: extra as unknown as Record<string, unknown>,
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

export { authHandler as GET, authHandler as POST };
