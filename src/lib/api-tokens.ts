// Tenant API token helpers. A token is 40 random bytes encoded as
// `pulse_ext_<hex>`. We hash (sha256) before writing, so the raw
// value only leaves the server at create time.
//
// Validation lookup happens in every extension endpoint, so it has
// to be cheap — hash the incoming token, single indexed lookup on
// the hash, done.

import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const PREFIX = "pulse_ext_";

export interface ApiTokenRecord {
  id: string;
  tenantSlug: string;
  name: string;
  tokenPrefix: string;
  tokenLast4: string;
  scope: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateToken(): string {
  return `${PREFIX}${randomBytes(32).toString("hex")}`;
}

export interface ResolvedApiToken {
  tenantSlug: string;
  tokenId: string;
  /** Split from the comma-separated `scope` column. */
  scopes: string[];
  /** The user who minted the token — used to attribute writes made
   * under token auth (no session user exists) back to a real person. */
  createdBy: string | null;
}

/**
 * Look up a token, confirm it's valid + un-revoked, and return the
 * tenant slug + scopes. Bumps last_used_at. Admin-scoped lookup so the
 * table isn't RLS-gated out from under us.
 */
export async function resolveApiToken(
  raw: string
): Promise<ResolvedApiToken | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const admin = createAdminClient();
  const hash = hashToken(raw);
  const { data, error } = await admin
    .from("tenant_api_tokens")
    .select("id, tenant_slug, revoked_at, scope, created_by")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;

  // Fire-and-forget; don't block the request on telemetry.
  admin
    .from("tenant_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  return {
    tenantSlug: data.tenant_slug,
    tokenId: data.id,
    scopes: (data.scope as string).split(",").map((s) => s.trim()).filter(Boolean),
    createdBy: data.created_by,
  };
}

export function extractBearer(req: Request): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1] ?? null;
}
