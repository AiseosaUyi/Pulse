// Google Drive integration. Hand-rolled OAuth (not via Composio —
// Composio's tools.execute is RPC-shaped and can't host the resumable
// upload session protocol). Mirrors the shape of integrations/ga4.ts:
// factory function, no module-load instantiation, structured error
// type with discriminated reasons.
//
// OAuth scopes used:
//   - drive.file: read/write files Pulse created or that the user
//     explicitly opened with Pulse. Used for uploads + folder mgmt.
//   - drive.readonly: read files the user has access to but didn't
//     create via Pulse. Required for paste-link imports — without
//     it, every imported file 404s even when the user owns it.
// Together these give a "create + read" posture without write
// access to existing user files. Picker would let us drop
// drive.readonly later.
//
// Tenant flow:
//   1. Owner/admin clicks "Connect Drive" in /settings/integrations
//   2. Redirect to Google OAuth consent
//   3. Callback (/api/integrations/drive/callback) exchanges code →
//      access+refresh tokens, stores in tenant_drive_connections
//   4. Callback bootstraps /Pulse + /Pulse/Social Content + /Pulse/
//      Video Extracts folders, stores IDs in content_sections
//
// Test seam: every external call goes through fetch(); tests stub
// global fetch. Resumable upload tests use a stub Drive server in
// Playwright global-setup (see plan-eng-review T1 decision).

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export const DRIVE_SCOPE = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export type DriveErrorReason =
  | "auth_revoked"
  | "rate_limited"
  | "quota_exceeded"
  | "file_missing"
  | "permission_denied"
  | "fetch_failed"
  | "config_missing";

export class DriveError extends Error {
  constructor(
    message: string,
    public reason: DriveErrorReason,
    public status?: number,
    public cause?: unknown
  ) {
    super(message);
    this.name = "DriveError";
  }
}

// ── Configuration ─────────────────────────────────────────────

interface DriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function readConfig(): DriveConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new DriveError(
      "Drive OAuth env vars missing (GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI)",
      "config_missing"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function isDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REDIRECT_URI
  );
}

// ── OAuth ────────────────────────────────────────────────────

export interface OAuthState {
  tenantSlug: string;
  nonce: string;
}

/**
 * Build the consent URL. `state` is a signed nonce we verify in the
 * callback (CSRF). Caller is responsible for storing the nonce
 * server-side (typically in a short-lived cookie).
 */
export function buildAuthUrl(state: string): string {
  const config = readConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance + scope re-prompt
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope: string;
  token_type: string;
}

/**
 * Exchange authorization code → tokens. Refresh token is only
 * returned on the first authorization (or when prompt=consent forces
 * it). Caller persists both into tenant_drive_connections.
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<TokenResponse> {
  const config = readConfig();
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 401) {
      throw new DriveError(
        `Drive code exchange failed: ${text}`,
        "auth_revoked",
        res.status
      );
    }
    throw new DriveError(
      `Drive code exchange failed (${res.status})`,
      "fetch_failed",
      res.status
    );
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Refresh an expired access token. Throws DriveError('auth_revoked')
 * if the refresh token itself is no longer valid (user revoked or
 * rotated). Caller marks tenant_drive_connections.status='revoked'.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const config = readConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (res.status === 400 || res.status === 401) {
    throw new DriveError(
      "Drive refresh token rejected — user must reconnect",
      "auth_revoked",
      res.status
    );
  }
  if (!res.ok) {
    throw new DriveError(
      `Drive refresh failed (${res.status})`,
      "fetch_failed",
      res.status
    );
  }
  const json = (await res.json()) as TokenResponse;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  };
}

// ── Folder bootstrap ─────────────────────────────────────────

export interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

/**
 * Idempotent — finds-or-creates a folder by name under `parentId`.
 * Returns the folder ID. On first run after OAuth this builds:
 *   /Pulse                       (parentId='root')
 *   /Pulse/Social Content        (parentId=<pulse_id>)
 *   /Pulse/Video Extracts        (parentId=<pulse_id>)
 */
export async function ensureFolder(
  accessToken: string,
  name: string,
  parentId: string
): Promise<DriveFolder> {
  // Check if it exists. Drive's name field is not unique; we filter
  // to non-trashed folders with the exact name owned by the user.
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `'${parentId}' in parents`,
    `trashed=false`,
  ].join(" and ");
  const listRes = await driveFetch(
    accessToken,
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`
  );
  const list = (await listRes.json()) as {
    files?: DriveFolder[];
  };
  if (list.files && list.files.length > 0) return list.files[0];

  // Create.
  const createRes = await driveFetch(accessToken, `${DRIVE_API_BASE}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return (await createRes.json()) as DriveFolder;
}

// ── Resumable upload ─────────────────────────────────────────

export interface ResumableSession {
  uri: string;
  driveFileId?: string; // populated after browser PUTs final chunk
}

/**
 * Initiates a resumable upload session and returns the session URI.
 * Browser PUTs chunks directly to that URI — Pulse's server is not
 * in the data path. This is the only way to handle multi-GB files
 * without burning Vercel function bandwidth or hitting the 300s
 * timeout.
 *
 * Returns just the URI; the file is not created until the browser
 * finishes the PUT sequence and we observe the resulting fileId.
 */
export async function createResumableSession(
  accessToken: string,
  args: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    parentId: string;
  }
): Promise<{ uri: string }> {
  const metadata = {
    name: args.filename,
    parents: [args.parentId],
    mimeType: args.mimeType,
  };

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": args.mimeType,
        "X-Upload-Content-Length": String(args.sizeBytes),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (res.status === 401) {
    throw new DriveError("Access token rejected", "auth_revoked", 401);
  }
  if (res.status === 403) {
    // 403 from Drive for upload typically means quota or storage
    // exceeded. Distinguish via the error body.
    const body = await res.text().catch(() => "");
    if (/storageQuotaExceeded|quotaExceeded/i.test(body)) {
      throw new DriveError(
        "Drive storage quota exceeded",
        "quota_exceeded",
        403
      );
    }
    throw new DriveError(
      "Drive upload forbidden",
      "permission_denied",
      403
    );
  }
  if (res.status === 429) {
    throw new DriveError("Drive rate limited", "rate_limited", 429);
  }
  if (!res.ok) {
    throw new DriveError(
      `Drive resumable session creation failed (${res.status})`,
      "fetch_failed",
      res.status
    );
  }

  const uri = res.headers.get("location");
  if (!uri) {
    throw new DriveError(
      "Drive returned 200 without a session URI",
      "fetch_failed",
      res.status
    );
  }
  return { uri };
}

// ── Read paths ───────────────────────────────────────────────

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // Drive returns size as a string for >2^31 byte files
  webViewLink?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
  trashed?: boolean;
}

/**
 * Batch metadata fetch for the list view. Drive doesn't expose a
 * true batch endpoint for v3 outside the deprecated /batch URL, so
 * we issue parallel requests with a concurrency cap. ~50 IDs at a
 * time stays comfortably under the 1000 req / 100s / user quota
 * even for active teams.
 */
export async function batchGetFiles(
  accessToken: string,
  ids: string[]
): Promise<Map<string, DriveFileMeta | null>> {
  const out = new Map<string, DriveFileMeta | null>();
  const fields =
    "id,name,mimeType,size,webViewLink,thumbnailLink,modifiedTime,trashed";

  // Concurrency cap of 8 — empirical balance between throughput and
  // Drive's per-second quota.
  const queue = [...ids];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const id = queue.pop();
      if (!id) break;
      try {
        const res = await driveFetch(
          accessToken,
          `${DRIVE_API_BASE}/files/${encodeURIComponent(id)}?fields=${fields}`
        );
        if (res.status === 404) {
          out.set(id, null);
          continue;
        }
        out.set(id, (await res.json()) as DriveFileMeta);
      } catch (err) {
        if (err instanceof DriveError && err.reason === "file_missing") {
          out.set(id, null);
        } else {
          // Re-throw config + auth errors; transient errors get null
          if (err instanceof DriveError && err.reason === "auth_revoked") {
            throw err;
          }
          out.set(id, null);
        }
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Internal ─────────────────────────────────────────────────

/**
 * Common fetch wrapper that maps HTTP statuses to DriveError reasons.
 * Used by everything except the bare token endpoints + resumable
 * session creation (those need response headers, not just JSON).
 */
async function driveFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(url, { ...init, headers });

  if (res.ok) return res;

  switch (res.status) {
    case 401:
      throw new DriveError("Access token rejected", "auth_revoked", 401);
    case 403: {
      const body = await res.clone().text().catch(() => "");
      if (/rateLimitExceeded|userRateLimitExceeded/i.test(body)) {
        throw new DriveError("Drive rate limited", "rate_limited", 403);
      }
      throw new DriveError(
        "Drive permission denied",
        "permission_denied",
        403
      );
    }
    case 404:
      throw new DriveError("Drive file not found", "file_missing", 404);
    case 429:
      throw new DriveError("Drive rate limited", "rate_limited", 429);
    default:
      throw new DriveError(
        `Drive request failed (${res.status})`,
        "fetch_failed",
        res.status
      );
  }
}
