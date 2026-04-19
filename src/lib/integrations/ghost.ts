// Ghost Admin API wrapper. Ghost admin keys are formatted `id:secret`
// where the secret is a hex-encoded 256-bit value. The SDK expects
// us to mint a short-lived JWT signed with the secret.
//
// Docs: https://ghost.org/docs/admin-api/

import { createHmac } from "node:crypto";

export interface GhostPostRequest {
  title: string;
  html: string;
  status: "draft" | "published";
  slug?: string;
  excerpt?: string;
  tags?: string[];
}

export interface GhostPostResult {
  ok: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export class GhostError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "GhostError";
  }
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint a 5-minute JWT signed with the admin key secret. Ghost admin
 * API expects `Authorization: Ghost <jwt>` with audience `/admin/`.
 */
function buildGhostJwt(id: string, secret: string): string {
  const header = { alg: "HS256", typ: "JWT", kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + 5 * 60,
    aud: "/admin/",
  };
  const encode = (obj: unknown) =>
    base64url(Buffer.from(JSON.stringify(obj)));
  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const secretBuf = Buffer.from(secret, "hex");
  const sig = createHmac("sha256", secretBuf)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(sig)}`;
}

function parseAdminKey(key: string): { id: string; secret: string } {
  const [id, secret] = key.split(":");
  if (!id || !secret) {
    throw new GhostError("Ghost admin key must be formatted id:secret", 400);
  }
  return { id, secret };
}

function ghostBase(adminUrl: string): string {
  const trimmed = adminUrl.replace(/\/+$/, "");
  return `${trimmed}/ghost/api/admin`;
}

async function ghostFetch<T>(
  adminUrl: string,
  adminKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { id, secret } = parseAdminKey(adminKey);
  const jwt = buildGhostJwt(id, secret);
  const res = await fetch(`${ghostBase(adminUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Ghost ${jwt}`,
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    errors?: Array<{ message?: string }>;
  } & Record<string, unknown>;
  if (!res.ok) {
    const msg =
      body.errors?.[0]?.message ?? `Ghost ${res.status} ${res.statusText}`;
    throw new GhostError(msg, res.status);
  }
  return body as T;
}

export async function publishToGhost(
  creds: { adminUrl: string; adminKey: string },
  request: GhostPostRequest
): Promise<GhostPostResult> {
  try {
    const body = await ghostFetch<{
      posts: Array<{ id: string; url: string }>;
    }>(creds.adminUrl, creds.adminKey, "/posts/?source=html", {
      method: "POST",
      body: JSON.stringify({
        posts: [
          {
            title: request.title,
            html: request.html,
            status: request.status,
            slug: request.slug,
            custom_excerpt: request.excerpt,
            tags: request.tags?.map((t) => ({ name: t })),
          },
        ],
      }),
    });
    const created = body.posts?.[0];
    return { ok: true, id: created?.id, url: created?.url };
  } catch (err) {
    if (err instanceof GhostError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ghost publish failed",
    };
  }
}

export async function testGhostConnection(creds: {
  adminUrl: string;
  adminKey: string;
}): Promise<{ ok: boolean; siteTitle?: string; error?: string }> {
  try {
    const body = await ghostFetch<{ site?: { title?: string } }>(
      creds.adminUrl,
      creds.adminKey,
      "/site/"
    );
    return { ok: true, siteTitle: body.site?.title };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection test failed",
    };
  }
}
