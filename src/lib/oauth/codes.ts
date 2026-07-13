import "server-only";
import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyCodeChallenge } from "./pkce";

const CODE_TTL_MS = 5 * 60_000; // 5 minutes — authorization codes are meant to be exchanged immediately

function hashCode(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface MintAuthorizationCodeInput {
  clientId: string;
  userId: string;
  tenantSlug: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export async function mintAuthorizationCode(
  admin: SupabaseClient,
  input: MintAuthorizationCodeInput
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const { error } = await admin.from("oauth_authorization_codes").insert({
    code_hash: hashCode(raw),
    client_id: input.clientId,
    user_id: input.userId,
    tenant_slug: input.tenantSlug,
    scopes: input.scopes.join(","),
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`mintAuthorizationCode: ${error.message}`);
  return raw;
}

export interface ConsumeAuthorizationCodeInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface ConsumedAuthorizationCode {
  clientId: string;
  userId: string;
  tenantSlug: string;
  scopes: string[];
}

export type ConsumeAuthorizationCodeResult =
  | { ok: true; grant: ConsumedAuthorizationCode }
  | { ok: false; error: string };

/** One-time-use, PKCE-verified. The conditional UPDATE (`used_at is
 * null`) is the concurrency guard — a replayed code can only win once,
 * same pattern as decideApproval()/recordManualPublish() elsewhere in
 * this codebase. */
export async function consumeAuthorizationCode(
  admin: SupabaseClient,
  input: ConsumeAuthorizationCodeInput
): Promise<ConsumeAuthorizationCodeResult> {
  const codeHash = hashCode(input.code);
  const { data: row } = await admin
    .from("oauth_authorization_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (!row) return { ok: false, error: "Invalid authorization code" };
  if (row.used_at) return { ok: false, error: "Authorization code already used" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Authorization code expired" };
  }
  if (row.redirect_uri !== input.redirectUri) {
    return { ok: false, error: "redirect_uri does not match the authorization request" };
  }
  if (!verifyCodeChallenge(input.codeVerifier, row.code_challenge, row.code_challenge_method)) {
    return { ok: false, error: "PKCE verification failed" };
  }

  const { data: updated, error } = await admin
    .from("oauth_authorization_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Authorization code already used" };
  }

  return {
    ok: true,
    grant: {
      clientId: row.client_id,
      userId: row.user_id,
      tenantSlug: row.tenant_slug,
      scopes: row.scopes.split(","),
    },
  };
}
