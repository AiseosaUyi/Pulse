// Drive connection storage + auto-refresh. Mirrors the integrations
// service shape (rowTo + admin variant for token-bearing reads).
//
// Token freshness rule: getActiveAccessToken() refreshes when the
// stored access token expires within 60 seconds. The refresh path
// updates the row in place. Concurrent callers are fine — last
// refresh wins; both end up with a valid token.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  DriveError,
  refreshAccessToken,
  type TokenResponse,
} from "@/lib/integrations/drive";
import type { TenantDriveConnection } from "@/lib/types/content-pipeline";

interface Row {
  tenant_slug: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  scope: string;
  root_folder_id: string | null;
  connected_by_user_id: string | null;
  status: "active" | "revoked" | "error";
  last_error: string | null;
  connected_at: string;
  updated_at: string;
}

function rowTo(row: Row): TenantDriveConnection {
  return {
    tenantSlug: row.tenant_slug,
    refreshToken: row.refresh_token,
    accessToken: row.access_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    scope: row.scope,
    rootFolderId: row.root_folder_id,
    connectedByUserId: row.connected_by_user_id,
    status: row.status,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

/** UI-safe snapshot — never includes refresh_token. */
export interface DriveConnectionStatus {
  connected: boolean;
  status: "active" | "revoked" | "error" | null;
  rootFolderId: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

/**
 * RLS-scoped read for the settings UI. Owner/admin gated by policy.
 */
export async function getDriveConnectionStatus(
  tenantSlug: string
): Promise<DriveConnectionStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_drive_connections")
    .select("status, root_folder_id, connected_at, last_error")
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!data) {
    return {
      connected: false,
      status: null,
      rootFolderId: null,
      connectedAt: null,
      lastError: null,
    };
  }
  return {
    connected: data.status === "active",
    status: data.status,
    rootFolderId: data.root_folder_id,
    connectedAt: data.connected_at,
    lastError: data.last_error,
  };
}

/**
 * Admin-scope read used by the upload pipeline + cron. Returns the
 * full row including secrets. NEVER expose the refresh_token to a
 * client component.
 */
export async function getDriveConnection(
  tenantSlug: string
): Promise<TenantDriveConnection | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_drive_connections")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}

/**
 * Insert or update on connect. Called by the OAuth callback after
 * exchanging the auth code.
 */
export async function upsertDriveConnection(args: {
  tenantSlug: string;
  tokens: TokenResponse;
  connectedByUserId: string;
  rootFolderId?: string;
}): Promise<void> {
  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + args.tokens.expires_in * 1000);
  const update: Record<string, unknown> = {
    tenant_slug: args.tenantSlug,
    access_token: args.tokens.access_token,
    access_token_expires_at: expiresAt.toISOString(),
    scope: args.tokens.scope,
    connected_by_user_id: args.connectedByUserId,
    status: "active",
    last_error: null,
  };
  // refresh_token is only present on first authorization (or after
  // prompt=consent). Don't overwrite a stored one with null.
  if (args.tokens.refresh_token) {
    update.refresh_token = args.tokens.refresh_token;
  }
  if (args.rootFolderId) {
    update.root_folder_id = args.rootFolderId;
  }

  const { error } = await admin
    .from("tenant_drive_connections")
    .upsert(update, { onConflict: "tenant_slug" });
  if (error) throw new Error(`Failed to upsert Drive connection: ${error.message}`);
}

/**
 * Returns a non-expired access token, refreshing if needed. Throws
 * DriveError('auth_revoked') if the refresh fails — caller should
 * mark the connection revoked + surface a reconnect banner.
 */
export async function getActiveAccessToken(
  tenantSlug: string
): Promise<{ accessToken: string; rootFolderId: string | null }> {
  const conn = await getDriveConnection(tenantSlug);
  if (!conn || conn.status !== "active") {
    throw new DriveError(
      "Drive not connected for this tenant",
      "auth_revoked"
    );
  }

  const expiresAt = conn.accessTokenExpiresAt
    ? new Date(conn.accessTokenExpiresAt).getTime()
    : 0;
  const sixtySecondsFromNow = Date.now() + 60_000;

  if (conn.accessToken && expiresAt > sixtySecondsFromNow) {
    return {
      accessToken: conn.accessToken,
      rootFolderId: conn.rootFolderId,
    };
  }

  // Refresh.
  try {
    const refreshed = await refreshAccessToken(conn.refreshToken);
    const admin = createAdminClient();
    await admin
      .from("tenant_drive_connections")
      .update({
        access_token: refreshed.accessToken,
        access_token_expires_at: refreshed.expiresAt.toISOString(),
        last_error: null,
      })
      .eq("tenant_slug", tenantSlug);
    return {
      accessToken: refreshed.accessToken,
      rootFolderId: conn.rootFolderId,
    };
  } catch (err) {
    if (err instanceof DriveError && err.reason === "auth_revoked") {
      const admin = createAdminClient();
      await admin
        .from("tenant_drive_connections")
        .update({
          status: "revoked",
          last_error: "Refresh token rejected — user must reconnect",
        })
        .eq("tenant_slug", tenantSlug);
    }
    throw err;
  }
}

/**
 * Mark a connection revoked (UI disconnect, or after a permanent
 * Drive auth error). Does NOT call Google's revoke endpoint — that
 * can be added later if needed; for now we just stop using the
 * tokens.
 */
export async function disconnectDrive(tenantSlug: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("tenant_drive_connections")
    .delete()
    .eq("tenant_slug", tenantSlug);
  if (error) throw new Error(`Failed to disconnect Drive: ${error.message}`);
}
