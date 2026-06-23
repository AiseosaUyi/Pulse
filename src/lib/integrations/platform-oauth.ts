// Shared OAuth state utilities for all 5 social platforms.
// Follows the same httpOnly-cookie pattern as /api/integrations/drive/connect.
// State format: nonce.tenantSlug.userId — stored in a per-platform cookie.

import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthPlatform = "x" | "linkedin" | "instagram" | "tiktok" | "youtube";

const STATE_TTL = 10 * 60; // 10 minutes

function cookieName(platform: OAuthPlatform): string {
  return `pulse_${platform}_oauth_state`;
}

export async function generateOAuthState(
  platform: OAuthPlatform,
  tenantSlug: string,
  userId: string
): Promise<string> {
  const nonce = randomBytes(24).toString("base64url");
  const payload = `${nonce}.${tenantSlug}.${userId}`;
  const store = await cookies();
  store.set(cookieName(platform), payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL,
    path: "/",
  });
  return payload;
}

export async function verifyOAuthState(
  platform: OAuthPlatform,
  returnedState: string
): Promise<{ tenantSlug: string; userId: string } | null> {
  const store = await cookies();
  const stored = store.get(cookieName(platform))?.value ?? "";
  store.delete(cookieName(platform));

  if (!stored || !returnedState) return null;
  const ab = Buffer.from(stored);
  const bb = Buffer.from(returnedState);
  if (ab.length !== bb.length || !timingSafeEqual(ab, bb)) return null;

  const parts = stored.split(".");
  if (parts.length !== 3) return null;
  const [, tenantSlug, userId] = parts;
  return { tenantSlug, userId };
}

// For X PKCE: store the code_verifier alongside the state cookie.
const X_VERIFIER_COOKIE = "pulse_x_pkce_verifier";

export async function storeXPkceVerifier(verifier: string): Promise<void> {
  const store = await cookies();
  store.set(X_VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL,
    path: "/",
  });
}

export async function popXPkceVerifier(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(X_VERIFIER_COOKIE)?.value ?? null;
  store.delete(X_VERIFIER_COOKIE);
  return value;
}

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}
