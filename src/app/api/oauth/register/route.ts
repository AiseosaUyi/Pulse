// RFC 7591 Dynamic Client Registration. Public endpoint — no auth (a
// client can't authenticate before it has credentials), rate-limited
// per-IP the same way every other pre-auth path in this codebase is.
// Always registers a public client (no secret) — see
// src/lib/oauth/clients.ts's registerClient().

import { z } from "zod";
import { checkPreAuthRateLimit } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/context";
import { corsPreflight } from "@/lib/api/cors";
import { oauthError, oauthOk } from "@/lib/oauth/respond";
import { registerClient } from "@/lib/oauth/clients";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string()).min(1),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const preAuth = checkPreAuthRateLimit(getClientIp(req));
  if (!preAuth.ok) {
    return oauthError(429, "server_error", "Rate limit exceeded");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthError(400, "invalid_request", "Invalid JSON body");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return oauthError(400, "invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const admin = createAdminClient();
  const result = await registerClient(admin, {
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
  });
  if (!result.ok) return oauthError(400, "invalid_request", result.error);

  const { client } = result;
  return oauthOk(
    {
      client_id: client.id,
      client_name: client.clientName ?? undefined,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
    },
    201
  );
}
