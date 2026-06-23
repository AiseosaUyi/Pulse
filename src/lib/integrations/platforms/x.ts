// X (Twitter) OAuth 2.0 with PKCE + publishing.
// Docs: https://developer.twitter.com/en/docs/authentication/oauth-2-0/authorization-code

import { createHash, randomBytes } from "node:crypto";

const X_AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const X_REVOKE_URL = "https://api.twitter.com/2/oauth2/revoke";
const X_TWEETS_URL = "https://api.twitter.com/2/tweets";
const X_SCOPES = ["tweet.write", "users.read", "offline.access"].join(" ");

export function isXConfigured(): boolean {
  return !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

function clientId(): string {
  return process.env.X_CLIENT_ID!;
}

function basicAuth(): string {
  return Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
}

// Generate a PKCE code_verifier + code_challenge (S256)
export function generateXPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildXAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: xCallbackUrl(),
    scope: X_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTH_URL}?${params}`;
}

function xCallbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/integrations/x/callback`;
}

export interface XTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeXCode(code: string, codeVerifier: string): Promise<XTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: xCallbackUrl(),
    code_verifier: codeVerifier,
  });
  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token exchange failed: ${text}`);
  }
  return res.json() as Promise<XTokens>;
}

export async function refreshXToken(refreshToken: string): Promise<XTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`X refresh failed: ${await res.text()}`);
  return res.json() as Promise<XTokens>;
}

export async function fetchXUser(accessToken: string): Promise<{ id: string; username: string }> {
  const res = await fetch("https://api.twitter.com/2/users/me?user.fields=username", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`X user fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { data: { id: string; username: string } };
  return data.data;
}

export async function revokeXToken(accessToken: string): Promise<void> {
  await fetch(X_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
  });
}

export async function publishXPost(
  accessToken: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  if (content.length > 280) {
    throw new Error(`X post exceeds 280 chars (${content.length})`);
  }
  const res = await fetch(X_TWEETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: content }),
  });
  if (!res.ok) {
    const text = await res.text();
    // 429 → caller should surface for QStash retry
    const err = new Error(`X publish failed (${res.status}): ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as { data: { id: string } };
  const postId = json.data.id;
  return { postId, postUrl: `https://x.com/i/web/status/${postId}` };
}
