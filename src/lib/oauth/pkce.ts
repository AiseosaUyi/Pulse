import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** RFC 7636 PKCE verification. Only S256 is supported (mandatory per the
 * authorization-server-metadata's code_challenge_methods_supported — the
 * "plain" method is not offered). */
export function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string
): boolean {
  if (method !== "S256") return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
