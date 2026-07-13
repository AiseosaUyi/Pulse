// Remote MCP server exposing every /api/v1 capability as an MCP tool,
// so Cowork (whose sandbox has no outbound internet — plain HTTP from
// a skill's shell doesn't reach Pulse) can drive Pulse over the MCP
// transport instead. Streamable HTTP only for now — SSE needs Redis
// for session state, deferred until that's provisioned (see
// docs/API-V1.md).
//
// Auth accepts TWO bearer token shapes, dual-checked by prefix in
// verifyToken() below: the existing static `pulse_ext_` token (via
// resolveApiToken(), identical to requireApiContext()'s REST-side gate —
// completely unchanged), and a self-issued OAuth 2.1 access token (via
// verifyAccessToken(), src/lib/oauth/tokens.ts — see docs/API-V1.md's
// "OAuth 2.1 for MCP clients" section). Both branches produce the exact
// same AuthInfo shape, so every tool's requireToolScope() call
// (src/lib/api/mcp-context.ts) works unmodified regardless of which auth
// path a given request took. Tools never accept a tenant argument from
// the model — requireToolScope() is the only way a tool resolves its
// tenant, from whichever token shape authenticated the request.

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveApiToken } from "@/lib/api-tokens";
import { checkPreAuthRateLimit } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/context";
import { appUrl } from "@/lib/integrations/platform-oauth";
import type { McpTokenExtra } from "@/lib/api/mcp-context";
import { verifyAccessToken } from "@/lib/oauth/tokens";
import { registerMetaTools } from "@/lib/mcp/tools/meta";
import { registerSalesTools } from "@/lib/mcp/tools/sales";
import { registerPublishingTools } from "@/lib/mcp/tools/publishing";
import { registerEngagementTools } from "@/lib/mcp/tools/engagement";
import { registerIntelTools } from "@/lib/mcp/tools/intel";
import { registerSeoTools } from "@/lib/mcp/tools/seo";
import { registerAnalyticsTools } from "@/lib/mcp/tools/analytics";
import { registerContentTools } from "@/lib/mcp/tools/content";
import { registerNotificationsTools } from "@/lib/mcp/tools/notifications";

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
    registerIntelTools(server);
    registerSeoTools(server);
    registerAnalyticsTools(server);
    registerContentTools(server);
    registerNotificationsTools(server);
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
  // Gate ahead of any token lookup/verification — same reasoning as REST's
  // requireApiContext(): any well-formed bearer costs a real Supabase
  // admin-client round-trip (or a JWT verify) whether or not it turns out
  // to be valid. withMcpAuth only distinguishes "auth failed" (this
  // return type) from success, so a rate-limited request surfaces as the
  // same 401 shape a bad token would — a minor simplification, not a 429.
  if (!checkPreAuthRateLimit(getClientIp(req)).ok) return undefined;

  if (bearerToken.startsWith("pulse_ext_")) {
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
  }

  // Not a static pulse_ext_ token — try it as an OAuth 2.1 access token
  // (src/lib/oauth/tokens.ts, minted by POST /api/oauth/token).
  const verified = await verifyAccessToken(bearerToken);
  if (!verified.ok) return undefined;
  const extra: McpTokenExtra = {
    tenantSlug: verified.claims.tenant_slug,
    tokenId: verified.claims.jti,
    createdBy: verified.claims.sub,
  };
  return {
    token: bearerToken,
    scopes: verified.claims.scopes.split(","),
    clientId: verified.claims.client_id,
    extra: extra as unknown as Record<string, unknown>,
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceUrl: appUrl("/api/mcp"),
});

export { authHandler as GET, authHandler as POST };
