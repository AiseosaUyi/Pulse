// RFC 6749 token endpoint — authorization_code and refresh_token grants.
// Public clients only (token_endpoint_auth_method: "none"), so there's no
// client_secret to check; PKCE (verified inside consumeAuthorizationCode)
// is what actually proves possession for the authorization_code grant.

import { z } from "zod";
import { checkPreAuthRateLimit } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/context";
import { corsPreflight } from "@/lib/api/cors";
import { oauthError, oauthOk } from "@/lib/oauth/respond";
import { consumeAuthorizationCode } from "@/lib/oauth/codes";
import { mintAccessToken, mintRefreshToken, rotateRefreshToken, isMcpOAuthConfigured } from "@/lib/oauth/tokens";
import { getClient } from "@/lib/oauth/clients";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const authCodeGrantSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().min(1),
  client_id: z.string().min(1),
  code_verifier: z.string().min(1),
});

const refreshGrantSchema = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1).optional(),
});

async function parseBody(req: Request): Promise<Record<string, string> | null> {
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return (await req.json()) as Record<string, string>;
    }
    const form = await req.formData();
    return Object.fromEntries(form.entries()) as Record<string, string>;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const preAuth = checkPreAuthRateLimit(getClientIp(req));
  if (!preAuth.ok) return oauthError(429, "server_error", "Rate limit exceeded");

  if (!isMcpOAuthConfigured()) {
    return oauthError(500, "server_error", "OAuth isn't configured (MCP_OAUTH_JWT_SECRET unset)");
  }

  const body = await parseBody(req);
  if (!body) return oauthError(400, "invalid_request", "Invalid request body");

  const admin = createAdminClient();

  if (body.grant_type === "authorization_code") {
    const parsed = authCodeGrantSchema.safeParse(body);
    if (!parsed.success) {
      return oauthError(400, "invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const client = await getClient(admin, parsed.data.client_id);
    if (!client) return oauthError(400, "invalid_client", "Unknown client_id");

    const consumed = await consumeAuthorizationCode(admin, {
      code: parsed.data.code,
      redirectUri: parsed.data.redirect_uri,
      codeVerifier: parsed.data.code_verifier,
    });
    if (!consumed.ok) return oauthError(400, "invalid_grant", consumed.error);
    if (consumed.grant.clientId !== parsed.data.client_id) {
      return oauthError(400, "invalid_grant", "Authorization code was not issued to this client");
    }

    const access = await mintAccessToken({
      userId: consumed.grant.userId,
      tenantSlug: consumed.grant.tenantSlug,
      scopes: consumed.grant.scopes,
      clientId: consumed.grant.clientId,
    });
    const refreshToken = await mintRefreshToken(admin, {
      clientId: consumed.grant.clientId,
      userId: consumed.grant.userId,
      tenantSlug: consumed.grant.tenantSlug,
      scopes: consumed.grant.scopes,
    });

    return oauthOk({
      access_token: access.token,
      token_type: "Bearer",
      expires_in: access.expiresIn,
      refresh_token: refreshToken,
      scope: consumed.grant.scopes.join(" "),
    });
  }

  if (body.grant_type === "refresh_token") {
    const parsed = refreshGrantSchema.safeParse(body);
    if (!parsed.success) {
      return oauthError(400, "invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const rotated = await rotateRefreshToken(admin, parsed.data.refresh_token);
    if (!rotated.ok) return oauthError(400, "invalid_grant", rotated.error);

    const access = await mintAccessToken({
      userId: rotated.claims.userId,
      tenantSlug: rotated.claims.tenantSlug,
      scopes: rotated.claims.scopes,
      clientId: rotated.claims.clientId,
    });

    return oauthOk({
      access_token: access.token,
      token_type: "Bearer",
      expires_in: access.expiresIn,
      refresh_token: rotated.refreshToken,
      scope: rotated.claims.scopes.join(" "),
    });
  }

  return oauthError(400, "unsupported_grant_type", `Unsupported grant_type: ${body.grant_type}`);
}
