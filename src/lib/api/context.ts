// Shared auth gate for every /api/v1/* route. Centralizes the pattern
// /api/ext/* duplicates per-file (extractBearer + resolveApiToken +
// manual 401), and adds what /api/ext/* never had: scope enforcement,
// rate limiting, and structured auth telemetry.

import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { hasScope, type ApiV1Scope } from "@/lib/api/scopes";
import { checkRateLimit, checkPreAuthRateLimit } from "@/lib/api/rate-limit";
import { corsHeaders } from "@/lib/api/cors";
import { apiError } from "@/lib/api/respond";

/** Best-effort client IP from the headers Vercel/most proxies set.
 * "unknown" (a single shared bucket) if none are present — still better
 * than no pre-auth limiting at all. */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface ApiContext {
  tenantSlug: string;
  tokenId: string;
  scopes: string[];
  /** The user who minted the token — attribute writes made under
   * token auth (no session user exists) back to a real person. */
  createdBy: string | null;
  admin: ReturnType<typeof createAdminClient>;
}

export type ApiContextResult =
  | { ok: true; context: ApiContext }
  | { ok: false; response: Response };

function logAuthAttempt(entry: {
  tokenId: string | null;
  route: string;
  status: number;
}) {
  // Cheap structured line — a table-backed API call log is a follow-up
  // (see docs/API-V1.md deviations); ai_call_log is AI-specific and
  // shouldn't be repurposed for generic request telemetry.
  console.log(`[api/v1] ${JSON.stringify(entry)}`);
}

export async function requireApiContext(
  req: Request,
  requiredScope: ApiV1Scope | null,
  corsMethods: string
): Promise<ApiContextResult> {
  const headers = corsHeaders(corsMethods);
  const route = new URL(req.url).pathname;

  const preAuth = checkPreAuthRateLimit(getClientIp(req));
  if (!preAuth.ok) {
    logAuthAttempt({ tokenId: null, route, status: 429 });
    return {
      ok: false,
      response: apiError(429, "Rate limit exceeded", {
        ...headers,
        "Retry-After": String(preAuth.retryAfterSeconds),
      }),
    };
  }

  const bearer = extractBearer(req);
  const resolved = bearer ? await resolveApiToken(bearer) : null;
  if (!resolved) {
    logAuthAttempt({ tokenId: null, route, status: 401 });
    return { ok: false, response: apiError(401, "Unauthorized", headers) };
  }

  if (!hasScope(resolved.scopes, requiredScope)) {
    logAuthAttempt({ tokenId: resolved.tokenId, route, status: 403 });
    return {
      ok: false,
      response: apiError(403, `Missing required scope: ${requiredScope}`, headers),
    };
  }

  const rl = checkRateLimit(resolved.tokenId);
  if (!rl.ok) {
    logAuthAttempt({ tokenId: resolved.tokenId, route, status: 429 });
    return {
      ok: false,
      response: apiError(429, "Rate limit exceeded", {
        ...headers,
        "Retry-After": String(rl.retryAfterSeconds),
      }),
    };
  }

  logAuthAttempt({ tokenId: resolved.tokenId, route, status: 200 });
  return {
    ok: true,
    context: {
      tenantSlug: resolved.tenantSlug,
      tokenId: resolved.tokenId,
      scopes: resolved.scopes,
      createdBy: resolved.createdBy,
      admin: createAdminClient(),
    },
  };
}
