// Shared auth/scope gate for every MCP tool — the MCP-transport analog
// of src/lib/api/context.ts's requireApiContext(). withMcpAuth() (see
// src/app/api/mcp/[transport]/route.ts) already resolved the bearer
// token via resolveApiToken() once per request and stashed the result
// on `extra.authInfo`; this just re-derives a typed, scope-checked
// context from it inside each tool handler, and builds the fresh admin
// client the same way requireApiContext() does.

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasScope, type ApiV1Scope } from "@/lib/api/scopes";
import { checkRateLimit } from "@/lib/api/rate-limit";

export interface McpTokenExtra {
  tenantSlug: string;
  tokenId: string;
  createdBy: string | null;
}

export interface McpToolContext {
  tenantSlug: string;
  tokenId: string;
  scopes: string[];
  createdBy: string | null;
  admin: ReturnType<typeof createAdminClient>;
}

/** Structural subset of the SDK's RequestHandlerExtra — every tool
 * callback's second param satisfies this, we just don't need the rest
 * of its fields (signal, sessionId, sendNotification, ...). */
export interface ToolHandlerExtra {
  authInfo?: AuthInfo;
}

export interface McpToolError {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

export function mcpToolError(text: string): McpToolError {
  return { content: [{ type: "text", text }], isError: true };
}

export function mcpToolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function requireToolScope(
  extra: ToolHandlerExtra,
  requiredScope: ApiV1Scope | null
): { ok: true; context: McpToolContext } | { ok: false; error: McpToolError } {
  const authInfo = extra.authInfo;
  const meta = authInfo?.extra as McpTokenExtra | undefined;
  if (!authInfo || !meta) {
    return { ok: false, error: mcpToolError("Unauthorized: no valid token") };
  }
  if (!hasScope(authInfo.scopes, requiredScope)) {
    return { ok: false, error: mcpToolError(`Missing required scope: ${requiredScope}`) };
  }
  const rl = checkRateLimit(meta.tokenId);
  if (!rl.ok) {
    return { ok: false, error: mcpToolError("Rate limit exceeded — slow down and try again shortly.") };
  }
  return {
    ok: true,
    context: {
      tenantSlug: meta.tenantSlug,
      tokenId: meta.tokenId,
      scopes: authInfo.scopes,
      createdBy: meta.createdBy,
      admin: createAdminClient(),
    },
  };
}
