// OAuth access + refresh token minting/verification for the MCP
// authorization server. Access tokens follow the same jose conventions as
// src/lib/approvals/token.ts (HS256, issuer "pulse", a distinct audience,
// an isXConfigured() guard, a discriminated-union verify result) — but a
// NEW dedicated secret, not the RS256 PULSE_JWKS_PRIVATE_KEY (that key is
// a live, different trust domain: Pulse signs, Gruve verifies, for
// Pulse→Gruve data APIs — reusing it here would conflate two independent
// trust domains under one key). No external party ever needs to verify
// these tokens, so a symmetric secret only Pulse knows is correct, same
// reasoning as preview-token.ts/approvals/token.ts.

import "server-only";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthAccessTokenClaims } from "./types";

const SECRET = process.env.MCP_OAUTH_JWT_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h — bounds the blast radius of a
// membership change not retroactively invalidating an already-issued token;
// refresh tokens (DB-backed) are what's actually revocable.
const REFRESH_TOKEN_PREFIX = "pulse_mcp_rt_";

export class McpOAuthNotConfiguredError extends Error {
  constructor() {
    super("MCP_OAUTH_JWT_SECRET is not set — cannot mint or verify OAuth access tokens.");
    this.name = "McpOAuthNotConfiguredError";
  }
}

export function isMcpOAuthConfigured(): boolean {
  return Boolean(SECRET);
}

export interface MintedAccessToken {
  token: string;
  expiresIn: number;
}

export async function mintAccessToken(claims: {
  userId: string;
  tenantSlug: string;
  scopes: string[];
  clientId: string;
}): Promise<MintedAccessToken> {
  if (!SECRET) throw new McpOAuthNotConfiguredError();
  const key = new TextEncoder().encode(SECRET);
  const jti = randomUUID();
  const token = await new SignJWT({
    tenant_slug: claims.tenantSlug,
    scopes: claims.scopes.join(","),
    client_id: claims.clientId,
  } satisfies Omit<OAuthAccessTokenClaims, "sub" | "jti">)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setJti(jti)
    .setIssuedAt()
    .setIssuer("pulse")
    .setAudience("pulse-mcp-oauth")
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .sign(key);
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export type VerifyAccessTokenResult =
  | { ok: true; claims: OAuthAccessTokenClaims }
  | { ok: false; reason: "not_configured" | "expired" | "invalid" };

export async function verifyAccessToken(token: string): Promise<VerifyAccessTokenResult> {
  if (!SECRET) return { ok: false, reason: "not_configured" };
  const key = new TextEncoder().encode(SECRET);
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: "pulse",
      audience: "pulse-mcp-oauth",
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.tenant_slug !== "string" ||
      typeof payload.scopes !== "string" ||
      typeof payload.client_id !== "string" ||
      typeof payload.jti !== "string"
    ) {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      claims: {
        sub: payload.sub,
        tenant_slug: payload.tenant_slug,
        scopes: payload.scopes,
        client_id: payload.client_id,
        jti: payload.jti,
      },
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRefreshToken(): string {
  return `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export interface RefreshTokenClaims {
  clientId: string;
  userId: string;
  tenantSlug: string;
  scopes: string[];
}

/** Mints and stores a new refresh token (hashed — the raw value only ever
 * leaves this function once, to the caller). */
export async function mintRefreshToken(
  admin: SupabaseClient,
  claims: RefreshTokenClaims,
  rotatedFrom?: string
): Promise<string> {
  const raw = generateRefreshToken();
  const { error } = await admin.from("oauth_refresh_tokens").insert({
    token_hash: hashRefreshToken(raw),
    client_id: claims.clientId,
    user_id: claims.userId,
    tenant_slug: claims.tenantSlug,
    scopes: claims.scopes.join(","),
    rotated_from: rotatedFrom ?? null,
  });
  if (error) throw new Error(`mintRefreshToken: ${error.message}`);
  return raw;
}

export type RotateRefreshTokenResult =
  | { ok: true; refreshToken: string; claims: RefreshTokenClaims }
  | { ok: false; error: string };

/** Validates a refresh token, revokes it, and mints a replacement in one
 * step (OAuth 2.1-recommended rotation for public clients). The
 * conditional UPDATE (`revoked_at is null`) is the concurrency guard — a
 * replayed/racing refresh token can only win the rotation once. */
export async function rotateRefreshToken(
  admin: SupabaseClient,
  rawToken: string
): Promise<RotateRefreshTokenResult> {
  const tokenHash = hashRefreshToken(rawToken);
  const { data: row } = await admin
    .from("oauth_refresh_tokens")
    .select("id, client_id, user_id, tenant_slug, scopes, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!row) return { ok: false, error: "Invalid refresh token" };
  if (row.revoked_at) return { ok: false, error: "Refresh token already used or revoked" };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Refresh token expired" };
  }

  const { data: updated, error } = await admin
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("revoked_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Refresh token already used or revoked" };
  }

  const claims: RefreshTokenClaims = {
    clientId: row.client_id,
    userId: row.user_id,
    tenantSlug: row.tenant_slug,
    scopes: row.scopes.split(","),
  };
  const newToken = await mintRefreshToken(admin, claims, row.id);
  return { ok: true, refreshToken: newToken, claims };
}
