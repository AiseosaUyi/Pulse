// Approval-link token minting/verification (Part 3 of the /api/v1 + MCP
// build spec). Mirrors the shape of src/lib/seo/preview-token.ts (short
// HS256 jose JWT) but is a distinct trust boundary — that module signs
// tokens Gruve verifies with a Gruve-shared secret; this one signs tokens
// Pulse itself verifies, for a link handed to a human, not another service.
//
// No jti replay ledger: the referenced approval_requests row's own
// `status` column is the one-time-use gate (see migration 091's comment).

import "server-only";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

const SECRET = process.env.APPROVAL_TOKEN_SECRET;
const TTL_MS = 72 * 60 * 60 * 1000; // 72h — long enough for a founder to get to it

export class ApprovalsNotConfiguredError extends Error {
  constructor() {
    super("APPROVAL_TOKEN_SECRET is not set — cannot mint approval links.");
    this.name = "ApprovalsNotConfiguredError";
  }
}

export function isApprovalsConfigured(): boolean {
  return Boolean(SECRET);
}

export function approvalTokenTtlMs(): number {
  return TTL_MS;
}

export async function mintApprovalToken(requestId: string): Promise<string> {
  if (!SECRET) throw new ApprovalsNotConfiguredError();
  const key = new TextEncoder().encode(SECRET);
  return new SignJWT({ sub: requestId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("pulse")
    .setAudience("pulse-approval")
    .setExpirationTime(Math.floor((Date.now() + TTL_MS) / 1000))
    .sign(key);
}

export type VerifyApprovalTokenResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: "not_configured" | "expired" | "invalid" };

export async function verifyApprovalToken(
  token: string
): Promise<VerifyApprovalTokenResult> {
  if (!SECRET) return { ok: false, reason: "not_configured" };
  const key = new TextEncoder().encode(SECRET);
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: "pulse",
      audience: "pulse-approval",
    });
    if (typeof payload.sub !== "string") return { ok: false, reason: "invalid" };
    return { ok: true, requestId: payload.sub };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
